import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AvatarMetaService } from '../avatar/avatar-meta.service';
import { isReservedBotName } from '../common/botname-enforce';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma.service';
import { AuthAccessService } from './auth.access.service';
import {
  BASE_URL,
  SALT_ROUNDS,
  formatVerifiedAt,
  normalizeEmail,
  randomSuffix,
  type PublicUser,
} from './auth.shared';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { LoginLockoutService } from './login-lockout.service';
import { MailService } from './mail.service';
import { SessionService } from './session.service';
import { TwoFactorService } from './twofactor.service';

// login()'s outcomes: an unverified address, a 2FA challenge, or a session.
// The explicit union lets the controller narrow on the variant it receives.
export type LoginResult =
  | { emailNotVerified: true }
  | { twoFactorRequired: true; pendingToken: string }
  | {
      twoFactorRequired: false;
      accessToken: string;
      refreshToken: string;
      user: PublicUser;
    };

// Account creation and the credential flows: register + verify, password login,
// reset, resend links, and the email-code second factor. The session itself is
// minted by AuthAccessService, which this service calls once a factor passes.
@Injectable()
export class AuthRegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly twoFactor: TwoFactorService,
    private readonly session: SessionService,
    private readonly loginLockout: LoginLockoutService,
    private readonly notifications: NotificationService,
    private readonly avatarMeta: AvatarMetaService,
    private readonly access: AuthAccessService,
  ) {}

  // Create a local (password) account: check username/email are free, hash
  // the password, create the User + Achievement rows, and email a signup
  // verification link. Called by auth.controller.ts POST /register.
  async register(dto: RegisterDto, baseUrl: string = BASE_URL) {
    // No account may wear a bot's name. Bots are seats, not accounts, and they own
    // the `bot-` stem: the DTO already forbids `-` and spaces, so this closes the
    // `bot_` / `BOT_` spellings before the name is minted.
    if (isReservedBotName(dto.username)) {
      throw new BadRequestException({
        code: 'AUTH_USERNAME_RESERVED',
        message: 'Username cannot start with "bot-"',
      });
    }

    const email = dto.email ? normalizeEmail(dto.email) : dto.email;
    if (email) {
      const emailTaken = await this.prisma.db.user.findUnique({ where: { email } });
      if (emailTaken) {
        throw new ConflictException({
          code: 'AUTH_EMAIL_TAKEN',
          message: 'Email already registered. Use a different email',
        });
      }
    }

    // Every new username ends with a random 4-digit number to prevent any username collision.
    let username = `${dto.username}${randomSuffix()}`;
    while (await this.prisma.db.user.findUnique({ where: { username } })) {
      username = `${dto.username}${randomSuffix()}`;
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await this.prisma.db.user.create({
      data: {
        id: crypto.randomUUID(),
        username,
        displayName: username,
        email,
        language: dto.language ?? 'en',
        password_hash: passwordHash,
        achievement: { create: { id: crypto.randomUUID() } },
        // Every account owns one career row. The postgame write updates it (and
        // upserts it), but a missing row here would mean a new account cannot
        // record its first match.
        stats: { create: {} },
      },
    });

    // Seed the avatar-meta cache: a fresh account has no photo, so every reader
    // (the engine included) can tell that from the very first join.
    await this.avatarMeta.set(user.id, { has: false, style: user.avatarStyle });

    // No session yet, the account activates via the emailed link.
    // The token goes in the URL *fragment*: fragments are not sent to the server,
    // so it cannot reach a log. The SPA strips it from history, then POSTs it.
    const token = await this.twoFactor.createVerifyToken(user.id);
    await this.mail.sendVerification(
      email,
      `${baseUrl}/verify-email#token=${token}`,
      user.language,
      user.username,
    );
    return { code: 'AUTH_ACCOUNT_CREATED', username };
  }

  // Redeems a signup verification link. Returns false for unknown/expired tokens.
  // Redeem an emailed link. Returns which kind it was so the controller can
  // redirect appropriately; 'invalid' for unknown/expired tokens.
  async verifyEmail(token: string): Promise<'signup' | 'change' | 'conflict' | 'invalid'> {
    // 1. Signup link (Redis `verify:` token) → mark the current address verified.
    const userId = await this.twoFactor.consumeVerifyToken(token);
    if (userId) {
      const emailVerifiedAt = new Date();
      const user = await this.prisma.db.user.update({
        where: { id: userId },
        data: { emailVerified: emailVerifiedAt },
      });
      console.log(`Email verified for ${user.username} at ${formatVerifiedAt(emailVerifiedAt)}`);
      return 'signup';
    }

    // 2. Email-change link (Redis `emailchange:<hash>`, single-use) → commit the
    //    staged address. An unknown/expired/consumed token simply isn't there.
    const change = await this.twoFactor.consumeEmailChangeToken(token);
    if (!change) return 'invalid';

    const user = await this.prisma.db.user.findUnique({ where: { id: change.userId } });
    if (!user) return 'invalid';

    // Commit-time conflict: the address may have been taken meanwhile. The
    // consume above already dropped the staged keys, so nothing is left behind.
    const taken = await this.prisma.db.user.findUnique({ where: { email: change.newEmail } });
    if (taken && taken.id !== user.id) {
      await this.mail
        .sendEmailChangeExpired(user.email ?? '', user.language, user.username)
        .catch(() => {});
      return 'conflict';
    }

    // Commit: apply the new address and mark it verified (the link proves inbox control).
    await this.prisma.db.user.update({
      where: { id: user.id },
      data: { email: change.newEmail, emailVerified: new Date() },
    });
    await this.notifications
      .notify(user.id, 'profile_updated', { items: ['email'] })
      .catch(() => {});
    return 'change';
  }

  // Factor one of password login: match identifier (username or email) and
  // password. An unverified address stops here; otherwise 2FA decides between
  // a session and an emailed code. Called by auth.controller.ts POST /login.
  async login(dto: LoginDto): Promise<LoginResult> {
    // Per-account gate before the password check: the route's @Throttle and
    // nginx's limit_req count the caller's address, so a spread-out attempt list
    // is not caught by either. Slows, then refuses, an account under attack.
    await this.loginLockout.gate(dto.identifier);

    // Accept either a username or an email in the same field.
    const user = await this.prisma.db.user.findFirst({
      where: {
        OR: [{ username: dto.identifier }, { email: normalizeEmail(dto.identifier) }],
      },
    });
    if (!user?.password_hash) {
      await this.loginLockout.recordFailure(dto.identifier);
      throw new UnauthorizedException({
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'Invalid username, email, or password',
      });
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.password_hash);
    if (!passwordMatches) {
      await this.loginLockout.recordFailure(dto.identifier);
      throw new UnauthorizedException({
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'Invalid username, email, or password',
      });
    }

    // The password is right, so the account starts clean: attempts that came
    // before a legitimate login must not slow the owner down afterwards.
    await this.loginLockout.recordSuccess(dto.identifier);

    // An unverified address cannot sign in. Returned as a result, not thrown:
    // the browser logs a failed status itself, and this is a normal state.
    if (!user.emailVerified) return { emailNotVerified: true as const };

    // 2FA off → password alone is enough; issue the session immediately.
    // 2FA on → password is only factor one; email a code and finish later.
    if (!user.twoFactorEnabled) {
      return {
        twoFactorRequired: false as const,
        ...(await this.access.issueSession(user.id, user.username)),
      };
    }
    const { pendingToken } = await this.startTwoFactor(
      user.id,
      user.email ?? '',
      user.username,
      user.language,
    );
    return { twoFactorRequired: true as const, pendingToken };
  }

  // Step one of reset: email a one-time link for password accounts only.
  // Same reply for every case, so callers can't probe which emails exist.
  async forgotPassword(rawEmail: string, baseUrl: string = BASE_URL) {
    const email = normalizeEmail(rawEmail);
    const user = await this.prisma.db.user.findUnique({ where: { email } });
    // Only local accounts have a password to reset; OAuth-only users (no
    // password_hash) sign in through their provider instead.
    if (user?.password_hash) {
      const token = await this.twoFactor.createResetToken(user.id);
      // As with the verification links, the token goes in the URL *fragment*,
      // which is never sent to the server, so it cannot reach a log. The SPA
      // strips it from history, then POSTs it in the body.
      await this.mail.sendPasswordReset(
        email,
        `${baseUrl}/reset-password#token=${token}`,
        user.language,
        user.username,
      );
    }
    return { code: 'AUTH_RESET_LINK_SENT' };
  }

  // Step two: redeem the link's token and set the new password.
  async resetPassword(token: string, newPassword: string) {
    const userId = await this.twoFactor.consumeResetToken(token);
    if (!userId) {
      throw new UnauthorizedException({
        code: 'AUTH_RESET_LINK_INVALID',
        message: 'This reset link is invalid or has expired',
      });
    }
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await this.prisma.db.user.update({
      where: { id: userId },
      data: {
        password_hash: passwordHash,
        // Redeeming an emailed link proves inbox control : the same guarantee
        // signup verification gives : so confirm the address if it wasn't yet.
        // Without this, an unverified user could reset yet still be login-blocked.
        emailVerified: new Date(),
      },
    });
    // drop every existing session after a password reset
    await this.session.revokeAll(userId);

    // Announce the password reset to the user. It is persisted, so it appears in
    // the bell on their next sign-in; this flow revokes all open sessions.
    await this.notifications
      .notify(userId, 'profile_updated', { items: ['password'] })
      .catch(() => {});

    return { code: 'AUTH_PASSWORD_RESET' };
  }

  // Resend a signup verification link. Always resolves the same way (no account
  // enumeration); only sends when the address exists and is unverified.
  async resendSignupVerification(rawEmail: string, baseUrl: string): Promise<{ code: string }> {
    const email = normalizeEmail(rawEmail);
    const user = await this.prisma.db.user.findUnique({ where: { email } });
    if (user?.emailVerified === null && user.email) {
      const token = await this.twoFactor.createVerifyToken(user.id);
      await this.mail
        .sendVerification(
          user.email,
          `${baseUrl}/verify-email#token=${token}`,
          user.language,
          user.username,
        )
        .catch(() => {});
    }
    return { code: 'AUTH_VERIFICATION_RESENT' };
  }

  // Resend the pending email-change link: rotates the token (invalidating the
  // previous link) and re-emails the pending address.
  async resendEmailChange(
    userId: string,
    baseUrl: string = BASE_URL,
  ): Promise<{ pendingEmail: string }> {
    const user = await this.prisma.db.user.findUnique({ where: { id: userId } });
    if (!user)
      throw new UnauthorizedException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    const pending = await this.twoFactor.peekEmailChange(userId);
    if (!pending) {
      throw new BadRequestException({
        code: 'NO_PENDING_EMAIL_CHANGE',
        message: 'There is no pending email change to resend',
      });
    }
    const token = await this.twoFactor.createEmailChangeToken(userId, pending.newEmail);
    await this.mail
      .sendEmailChange(
        pending.newEmail,
        `${baseUrl}/verify-email#token=${token}`,
        user.language,
        user.username,
      )
      .catch(() => {});
    return { pendingEmail: pending.newEmail };
  }

  // Factor two: email a one-time code, hand back the challenge reference.
  async startTwoFactor(userId: string, email: string, username?: string, lang = 'en') {
    const { pendingToken, code } = await this.twoFactor.startChallenge(userId);
    await this.mail.send2faCode(email, code, lang, username);
    return { pending: true as const, pendingToken };
  }

  // Re-issue the 2FA login code for a live challenge (same pendingToken).
  async resendTwoFactor(pendingToken: string): Promise<{ code: string }> {
    const result = await this.twoFactor.resendChallenge(pendingToken);
    if (result === 'expired') {
      throw new BadRequestException({
        code: 'AUTH_CODE_EXPIRED',
        message: 'This code has expired: log in again to get a new one.',
      });
    }
    if (result === 'locked') {
      throw new HttpException(
        { code: 'AUTH_CODE_RESEND_LOCKED', message: 'Too many code requests: try again later.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const user = await this.prisma.db.user.findUnique({
      where: { id: result.userId },
      select: { email: true, username: true, language: true },
    });
    if (user?.email) {
      await this.mail
        .send2faCode(user.email, result.code, user.language, user.username)
        .catch(() => {});
    }
    return { code: 'AUTH_CODE_RESENT' };
  }

  // Factor two of 2FA login: check the emailed code against the pending
  // token and issue the full session. Called by auth.controller.ts
  // POST /twofactor.
  async completeTwoFactor(pendingToken: string, code: string) {
    const userId = await this.twoFactor.verifyChallenge(pendingToken, code);
    if (!userId) {
      throw new UnauthorizedException({
        code: 'AUTH_CODE_INVALID',
        message: 'Invalid or expired code',
      });
    }
    const user = await this.prisma.db.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException({
        code: 'AUTH_CODE_INVALID',
        message: 'Invalid or expired code',
      });
    }
    return this.access.issueSession(user.id, user.username);
  }
}
