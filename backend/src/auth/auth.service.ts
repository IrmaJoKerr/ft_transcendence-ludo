import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'node:crypto';
import Redis from 'ioredis';
import { PrismaService } from '../prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { JwtPayload } from './jwt-payload';
import { AUTH, OAUTH_LINK_AUDIENCE, OAUTH_LINK_TTL } from './auth.constants';
import { MailService } from './mail.service';
import { TwoFactorService } from './twofactor.service';
import { SessionService } from './session.service';
import { LoginLockoutService } from './login-lockout.service';
import { requireSecret, secret } from '../secrets';
import { NotificationService } from '../notification/notification.service';
import { AvatarMetaService } from '../avatar/avatar-meta.service';
import { FriendshipEventsService } from '../friends/friendship-events.service';
import { isReservedBotName } from '../common/botname-enforce';
import { publishMatchAbandon } from '../common/channels';
import { findLiveMatch, matchSeatIds } from '../match/active-game';

const SALT_ROUNDS = 10;
// Also where the SPA lives; /api on the same origin reaches the backend
// through whichever proxy (nginx or Vite) is serving it. Required by the
// make env preflight, so no hardcoded fallback here.
const BASE_URL = requireSecret('FRONTEND_URL');

// store all email as lowercase since email is case-insensitive
const normalizeEmail = (email: string) => email.trim().toLowerCase();

// The part of an OAuth callback request that auth code reads: the provider
// `state` query param (a signed oauth-link token) and the access-token cookie.
// `query` stays structural so an Express Request or ParsedQs satisfies it.
export interface OAuthCallbackRequest {
  query?: { state?: unknown };
  cookies?: Record<string, unknown>;
}

// convert at read/display time
const formatVerifiedAt = (date: Date) =>
  new Intl.DateTimeFormat('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);

// Columns an OAuth strategy may consume after validateOAuthLogin: the session needs
// id/username/language, the 2FA branch needs email/twoFactorEnabled and the create
// branch seeds avatarMeta. Selecting these keeps `password_hash` out of reach.
const OAUTH_USER_FIELDS = {
  id: true,
  username: true,
  email: true,
  twoFactorEnabled: true,
  language: true,
  avatarStyle: true,
} as const;

// The canonical user object every auth response returns (login, 2FA verify,
// refresh, /me, PATCH profile). The SPA stores it wholesale, so a partial shape
// reads there as "missing"/"off": an absent email faked an email change.
export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  emailVerified: boolean;
  pendingEmail: string | null;
  hasPassword: boolean;
  twoFactorEnabled: boolean;
  avatarStyle: string;
  hasAvatarPhoto: boolean;
  providers: string[];
}

// The User columns publicUser() reads. Structural, so a full Prisma row from
// findUnique/update satisfies it without the generated model type.
type UserRow = {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  emailVerified: Date | null;
  password_hash: string | null;
  twoFactorEnabled: boolean;
  avatarStyle: string;
  avatarPhotoContentType: string | null;
};

// login()'s outcomes: an unverified address, a 2FA challenge, or a session.
// The explicit union lets the controller narrow on the variant it receives.
type LoginResult =
  | { emailNotVerified: true }
  | { twoFactorRequired: true; pendingToken: string }
  | {
      twoFactorRequired: false;
      accessToken: string;
      refreshToken: string;
      user: PublicUser;
    };

@Injectable()
// All account logic: register/login with email verification + 2FA, session
// tokens, OAuth linking, profile/password changes, account deletion. Called
// by auth.controller.ts and the OAuth strategies.
export class AuthService implements OnModuleDestroy {
  // Redis client used only for account-deletion cleanup (matches, presence,
  // invites, leaderboard entries).
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly twoFactor: TwoFactorService,
    private readonly session: SessionService,
    private readonly loginLockout: LoginLockoutService,
    private readonly notifications: NotificationService,
    private readonly avatarMeta: AvatarMetaService,
    private readonly friendshipEvents: FriendshipEventsService,
  ) {
    // Small Redis client for account-deletion cleanup (same idiom as
    // FriendsService / MatchPlayerService).
    const host = process.env.REDIS_HOST ?? 'redis';
    const port = parseInt(process.env.REDIS_PORT ?? '6479', 10);
    const password = secret('REDIS_PASSWORD');
    this.redis = new Redis({ host, port, password, retryStrategy: (t) => Math.min(t * 50, 2000) });
    this.redis.on('error', (error) => {
      console.error('Auth Redis error:', error.message);
    });
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }

  // Random 4-digit suffix (1000–9999) appended to every new username.
  private randomSuffix(): string {
    return randomInt(1000, 10_000).toString();
  }

  // Per-user rolling-hour cap on email-address changes (Redis INCR, TTL = window).
  private async enforceEmailChangeLimit(userId: string): Promise<void> {
    const key = `emailchange:rl:${userId}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 60 * 60);
    if (count > AUTH.maxEmailChangesPerHour) {
      throw new HttpException(
        { code: 'AUTH_EMAIL_CHANGE_RATE_LIMITED', message: 'Too many email change requests' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  // Create a local (password) account: check username/email are free, hash
  // the password, create the User + Achievement rows, and email a signup
  // verification link. Called by auth.controller.ts POST /register.
  async register(dto: RegisterDto, baseUrl: string = BASE_URL) {
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
    let username = `${dto.username}${this.randomSuffix()}`;
    while (await this.prisma.db.user.findUnique({ where: { username } })) {
      username = `${dto.username}${this.randomSuffix()}`;
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
        ...(await this.issueSession(user.id, user.username)),
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
    return this.issueSession(user.id, user.username);
  }

  // Sign a short-lived access-token JWT (15m, per JwtModule config).
  signAccess(userId: string, username: string): string {
    const payload: JwtPayload = { sub: userId, username };
    return this.jwt.sign(payload);
  }

  // Issue a fresh session: a short-lived access token plus a long-lived,
  // revocable refresh token. Called once both login factors pass.
  async issueSession(userId: string, username: string) {
    const accessToken = this.signAccess(userId, username);
    const refreshToken = await this.session.issue(userId);
    const user = await this.prisma.db.user.findUnique({ where: { id: userId } });
    if (!user)
      throw new UnauthorizedException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    return { accessToken, refreshToken, user: await this.publicUser(user) };
  }

  // Trade a refresh token for a new access token, rotating the refresh token
  // in the same step. Throws 401 when it's missing/expired/revoked.
  async refresh(refreshToken?: string) {
    if (!refreshToken)
      throw new UnauthorizedException({
        code: 'AUTH_NOT_AUTHENTICATED',
        message: 'Not authenticated',
      });
    const rotated = await this.session.rotate(refreshToken);
    // A token that was already rotated and came back outside the race window:
    // the session store has revoked every session of that user already.
    if (rotated && 'reused' in rotated)
      throw new UnauthorizedException({
        code: 'AUTH_SESSION_REUSED',
        message: 'Refresh token reuse detected : all sessions were revoked',
      });
    if (!rotated)
      throw new UnauthorizedException({
        code: 'AUTH_SESSION_EXPIRED',
        message: 'Session expired : please log in again',
      });
    const user = await this.prisma.db.user.findUnique({ where: { id: rotated.userId } });
    if (!user)
      throw new UnauthorizedException({
        code: 'AUTH_SESSION_EXPIRED',
        message: 'Session expired : please log in again',
      });
    return {
      accessToken: this.signAccess(user.id, user.username),
      refreshToken: rotated.newToken,
      user: await this.publicUser(user),
    };
  }

  // Revoke the given refresh token : logout on this device. A live room cannot
  // outlive the sign-out: the engine owns the departure (seat parked, turn
  // advanced, `player_exited`), so this publishes the room and the player and lets
  // it finalize the seat under its game lock (D7). The revoke already reads the
  // userId, so the id costs no second lookup, and the publish is best effort: a
  // missed message falls back to the seat's own reconnect window.
  async logout(refreshToken?: string) {
    const userId = refreshToken ? await this.session.revoke(refreshToken) : null;
    if (!userId) return;
    try {
      const live = await findLiveMatch(this.redis, userId);
      if (live) await publishMatchAbandon(this.redis, live.gameId, userId);
    } catch (error) {
      console.error('logout match:abandon error:', (error as Error).message);
    }
  }

  // Build the canonical user payload shared by every auth response (PublicUser).
  private async publicUser(user: UserRow): Promise<PublicUser> {
    const accounts = await this.prisma.db.account.findMany({
      where: { userId: user.id },
      select: { provider: true },
    });
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      emailVerified: user.emailVerified !== null,
      pendingEmail: (await this.twoFactor.peekEmailChange(user.id))?.newEmail ?? null,
      hasPassword: !!user.password_hash,
      twoFactorEnabled: user.twoFactorEnabled,
      avatarStyle: user.avatarStyle,
      hasAvatarPhoto: user.avatarPhotoContentType !== null,
      providers: accounts.map((a) => a.provider),
    };
  }

  // Full profile for the Edit-Profile card (incl. linked OAuth providers).
  async getProfile(userId: string) {
    const user = await this.prisma.db.user.findUnique({ where: { id: userId } });
    if (!user)
      throw new UnauthorizedException({ code: 'USER_NOT_FOUND', message: 'User not found' });

    // Repair the avatar-meta cache from this row: /me is the payload every session
    // loads, so the cached flag follows the stored row at no extra query cost.
    // Await it so the repair has landed before `publicUser` answers, but keep no
    // stamp: /me reports the stored flag, and the stamp is the profile read's job.
    await this.avatarMeta.syncFromUser(user);

    return { user: await this.publicUser(user) };
  }

  // Validates a short-lived access-token JWT (the `token` cookie). Returns the
  // user id when valid, else null. Used to confirm an OAuth callback is a
  // genuine "add method" round-trip from an already-authenticated browser.
  verifyAccessToken(token: string | undefined): string | null {
    if (!token) return null;
    try {
      // Issuer/audience/algorithm are enforced by JwtModule's verifyOptions.
      const payload = this.jwt.verify<{ sub?: unknown }>(token);
      return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
    } catch {
      return null;
    }
  }

  // Turn email-code 2FA on or off for the user. Turning it off weakens the
  // account, so a password account must confirm its current password first;
  // OAuth-only accounts are trusted through the active session.
  async setTwoFactorSetting(userId: string, enabled: boolean, currentPassword?: string) {
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { password_hash: true, twoFactorEnabled: true },
    });
    if (!user)
      throw new UnauthorizedException({ code: 'USER_NOT_FOUND', message: 'User not found' });

    if (enabled !== user.twoFactorEnabled && user.password_hash) {
      const matches = await bcrypt.compare(currentPassword ?? '', user.password_hash);
      if (!matches)
        throw new UnauthorizedException({
          code: 'AUTH_CURRENT_PASSWORD_INCORRECT',
          message: 'Current password is incorrect',
        });
    }

    await this.prisma.db.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: enabled },
    });
    return { twoFactorEnabled: enabled };
  }

  // Complete profile update : edit display name, email, and/or the email-code
  // 2FA method in one call; only provided fields change. Email changes reuse
  // the signup verification flow. Username is immutable.
  async updateProfile(
    userId: string,
    dto: {
      displayName?: string;
      email?: string;
      currentPassword?: string;
      twoFactorEnabled?: boolean;
      language?: string;
      oauthToAdd?: string;
      oauthToRemove?: string;
    },
    baseUrl: string = BASE_URL,
  ) {
    const user = await this.prisma.db.user.findUnique({ where: { id: userId } });
    if (!user)
      throw new UnauthorizedException({ code: 'USER_NOT_FOUND', message: 'User not found' });

    const data: Record<string, unknown> = {};
    let emailChanged = false;
    let newEmail: string | undefined;
    let changeToken: string | undefined;
    // Items actually changed in this request that warrant a persisted
    // self-confirmation. A display-name change is announced transiently instead
    // (see below), so it is deliberately not collected here.
    const changedItems: string[] = [];

    // Re-auth gate for email, the 2FA toggle and OAuth linking or unlinking: one
    // current-password check covers the requested change. OAuth-only accounts have
    // no password and pass on the active session; an email change still needs one.
    const requestedEmail = dto.email !== undefined ? normalizeEmail(dto.email) : undefined;
    const pendingEmail =
      requestedEmail !== undefined
        ? (await this.twoFactor.peekEmailChange(userId))?.newEmail
        : undefined;
    const emailChanging =
      requestedEmail !== undefined &&
      requestedEmail !== user.email &&
      requestedEmail !== pendingEmail;
    const twoFactorChanging =
      dto.twoFactorEnabled !== undefined && dto.twoFactorEnabled !== user.twoFactorEnabled;
    const oauthChanging = dto.oauthToAdd !== undefined || dto.oauthToRemove !== undefined;

    if (user.password_hash && (emailChanging || twoFactorChanging || oauthChanging)) {
      const passwordOk = await bcrypt.compare(dto.currentPassword ?? '', user.password_hash);
      if (!passwordOk) {
        throw new UnauthorizedException({
          code: 'AUTH_CURRENT_PASSWORD_INCORRECT',
          message: 'Current password is incorrect',
        });
      }
    }

    if (dto.displayName !== undefined && dto.displayName !== user.displayName) {
      // No masquerading as a bot.
      if (isReservedBotName(dto.displayName)) {
        throw new BadRequestException({
          code: 'AUTH_DISPLAY_NAME_RESERVED',
          message: 'Display name cannot start with "bot-"',
        });
      }
      const taken = await this.prisma.db.user.findUnique({
        where: { displayName: dto.displayName },
      });
      if (taken)
        throw new ConflictException({
          code: 'AUTH_DISPLAY_NAME_TAKEN',
          message: 'Display name is already taken',
        });
      data.displayName = dto.displayName;
    }

    if (emailChanging) {
      // A password is required to change the address; OAuth-only accounts must
      // set one first (mirrors deleteAccount). The password was checked in the
      // re-auth gate above when the account has one.
      if (!user.password_hash) {
        throw new BadRequestException({
          code: 'AUTH_EMAIL_CHANGE_SET_PASSWORD',
          message: 'Set a password before changing your email',
        });
      }
      // Per-user cap on address changes (separate from the route-level throttle).
      await this.enforceEmailChangeLimit(userId);
      const emailTaken = await this.prisma.db.user.findUnique({ where: { email: requestedEmail } });
      if (emailTaken) {
        throw new ConflictException({
          code: 'AUTH_EMAIL_TAKEN',
          message: 'Email already registered. Use a different email',
        });
      }
      // Stage the change (verify-then-commit): the row email is NOT touched
      // yet. The token + pending payload live in Redis with a 15-min TTL; the
      // reverse pointer is what the expiry listener watches.
      changeToken = await this.twoFactor.createEmailChangeToken(userId, requestedEmail);
      emailChanged = true;
      newEmail = requestedEmail;
    }

    if (dto.twoFactorEnabled !== undefined) {
      data.twoFactorEnabled = dto.twoFactorEnabled;
    }

    if (dto.language !== undefined) {
      data.language = dto.language;
    }

    // OAuth: remove a linked sign-in method (lockout-guarded).
    if (dto.oauthToRemove !== undefined) {
      await this.removeOAuthMethod(userId, dto.oauthToRemove);
      changedItems.push('oauthRemove');
    }

    // OAuth: adding a method needs the browser round-trip : mint a 10m
    // oauth-link token and hand back the provider authorize URL with it in
    // `state`; the callback then links the provider to this user.
    let oauthRedirectUrl: string | undefined;
    if (dto.oauthToAdd !== undefined) {
      const state = this.createOAuthLinkToken(userId, dto.oauthToAdd);
      // Relative path (same as the login page's OAuthButtons) so it resolves on
      // whatever host the user is actually connected through (LAN IP, tunnel, etc.).
      oauthRedirectUrl = `/api/auth/${encodeURIComponent(dto.oauthToAdd)}?state=${encodeURIComponent(state)}`;
    }

    const updated =
      Object.keys(data).length > 0
        ? await this.prisma.db.user.update({ where: { id: userId }, data })
        : user;

    // Email change → email the confirmation link to the NEW address + a heads-up
    // to the old one. On send failure, roll back the pending fields.
    if (emailChanged && newEmail && changeToken) {
      try {
        await this.mail.sendEmailChange(
          newEmail,
          `${baseUrl}/verify-email#token=${changeToken}`,
          user.language,
          user.username,
        );
        await this.mail
          .sendEmailChangeNotice(user.email ?? '', newEmail, user.language, user.username)
          .catch(() => {});
      } catch (err) {
        // Mail never went out : drop the staged Redis change (best-effort).
        await this.twoFactor.clearEmailChange(userId).catch(() => {});
        throw err;
      }
    }

    // Profile-change notifications, 1 of 2: the persisted self-confirmation
    // ("You have updated your profile: …"). A display-name change skips it and
    // uses the transient push below, so the actor never gets two notices.
    if (emailChanged) changedItems.push('email');
    if (dto.twoFactorEnabled !== undefined && dto.twoFactorEnabled !== user.twoFactorEnabled) {
      changedItems.push('twoFactor');
    }
    if (changedItems.length > 0) {
      await this.notifications
        .notify(userId, 'profile_updated', { items: changedItems })
        .catch(() => {});
    }

    // Profile-change notifications, 2 of 2: a transient toast for the actor only.
    // notifyTransient reaches this user's clients and persists nothing.
    if (data.displayName !== undefined) {
      await this.notifications
        .notifyTransient(userId, 'display_name_changed', {
          fromUserId: userId,
          fromUsername: user.username,
          oldDisplayName: user.displayName,
          displayName: dto.displayName,
        })
        .catch(() => {});
      // The content half of every accepted friend's row (D2): a rename is a row
      // update for them, exactly like the avatar and the postgame rating.
      void this.friendshipEvents.publishSubject(userId);
    }

    // Same canonical user shape as every other auth response (email stays the
    // current address while a change is pending).
    return {
      user: await this.publicUser(updated),
      emailChangePending: emailChanged,
      pendingEmail: newEmail,
      oauthRedirectUrl,
    };
  }

  // Logged-in password change: verify the current password (if one exists),
  // set the new one, and revoke every other session. OAuth-only accounts
  // set their FIRST password here.
  async changePassword(
    userId: string,
    currentPassword: string | undefined,
    newPassword: string,
    currentRefreshToken?: string,
  ) {
    const user = await this.prisma.db.user.findUnique({ where: { id: userId } });
    if (!user)
      throw new UnauthorizedException({ code: 'USER_NOT_FOUND', message: 'User not found' });

    if (user.password_hash) {
      const matches = await bcrypt.compare(currentPassword ?? '', user.password_hash);
      if (!matches)
        throw new UnauthorizedException({
          code: 'AUTH_CURRENT_PASSWORD_INCORRECT',
          message: 'Current password is incorrect',
        });
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await this.prisma.db.user.update({
      where: { id: userId },
      data: { password_hash: passwordHash },
    });

    // Log the user out everywhere : other devices must re-auth with the new password.
    await this.session.revokeAllExcept(userId, currentRefreshToken);

    await this.notifications
      .notify(userId, 'profile_updated', { items: ['password'] })
      .catch(() => {});

    return { code: 'AUTH_PASSWORD_UPDATED' };
  }

  // Permanently delete the user's account. Requires `confirm: true` and a
  // verified password. Redis/other cleanup runs first; the DB delete (last)
  // is the single point of no return.
  async deleteAccount(userId: string, dto: DeleteAccountDto) {
    if (!dto.confirm)
      throw new BadRequestException({
        code: 'AUTH_DELETE_CONFIRM_REQUIRED',
        message: 'You must confirm account deletion',
      });

    const user = await this.prisma.db.user.findUnique({ where: { id: userId } });
    if (!user)
      throw new UnauthorizedException({ code: 'USER_NOT_FOUND', message: 'User not found' });

    if (!user.password_hash) {
      throw new ForbiddenException({
        code: 'AUTH_DELETE_SET_PASSWORD',
        message: 'Set a password before deleting your account',
      });
    }
    const matches = await bcrypt.compare(dto.currentPassword ?? '', user.password_hash);
    if (!matches)
      throw new UnauthorizedException({
        code: 'AUTH_CURRENT_PASSWORD_INCORRECT',
        message: 'Current password is incorrect',
      });

    // 1. Abort live matches the user is seated in, so a deleted user_id can
    //    never FK-fail processGameEnd and void the opponents' results.
    await this.abortUserMatches(userId);

    // 2. Drop ephemeral Redis state (presence, invites, leaderboard entries).
    await this.clearUserRedisState(userId);
    //    ...and the avatar-meta record, so a deleted account leaves none behind.
    await this.avatarMeta.remove(userId);

    // 3. Revoke every refresh session : all devices are logged out.
    await this.session.revokeAll(userId);

    // 4. DB: user.delete() cascades Account/Achievement/GameParticipant/Friendship.
    //    The user's Redis leaderboard entry is already removed by
    //    clearUserRedisState above; the bell is two `notif:` keys (D12), so it is
    //    deleted explicitly below.
    await this.prisma.db.user.delete({ where: { id: userId } });
    // Best effort: a stale inbox for a gone account is unreachable and expires in
    // 14 days, so this must not fail the deletion.
    await this.notifications.clear(userId).catch(() => {});

    return { code: 'AUTH_ACCOUNT_DELETED' };
  }

  // Mark every WAITING/ACTIVE match the user is seated in as ABORTED (1h TTL).
  private async abortUserMatches(userId: string): Promise<void> {
    try {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', 'match:*', 'COUNT', 100);
        cursor = nextCursor;
        for (const key of keys) {
          const data = await this.redis.hgetall(key);
          const seated = matchSeatIds(data).includes(userId);
          if (seated && (data.status === 'WAITING' || data.status === 'ACTIVE')) {
            await this.redis.hset(key, 'status', 'ABORTED');
            await this.redis.expire(key, 3600);
          }
        }
      } while (cursor !== '0');
    } catch (error) {
      console.error('abortUserMatches error:', (error as Error).message);
    }
  }

  // Remove the user's ephemeral Redis state (presence, invites, leaderboard).
  private async clearUserRedisState(userId: string): Promise<void> {
    try {
      await this.redis.del(`presence:${userId}`, `invite:${userId}`);
      for (const mode of ['global', 'ranked', 'casual', 'bot']) {
        await this.redis.zrem(`leaderboard:${mode}`, userId);
      }
    } catch (error) {
      console.error('clearUserRedisState error:', (error as Error).message);
    }
  }

  // Called after a provider (Google/GitHub) has verified the user.
  // Finds the matching user, or links/creates one, then returns it.
  async validateOAuthLogin(
    input: {
      provider: string;
      providerAccountId: string;
      email?: string;
      usernameSeed: string;
    },
    linkUserId?: string,
  ) {
    // EMAIL OWNERSHIP RULE: a provider's email only sets email/emailVerified
    // on FIRST sign-in. The "add sign-in method" flow (linkUserId) ignores it
    // : linking 42 to a Google account keeps the Google email and its state.

    // If provider account exist just log them in
    const existingAccount = await this.prisma.db.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider: input.provider,
          providerAccountId: input.providerAccountId,
        },
      },
      select: { userId: true, user: { select: OAUTH_USER_FIELDS } },
    });
    if (existingAccount) {
      // "Add method" intent: same user -> no-op, different user -> conflict.
      if (linkUserId && existingAccount.userId !== linkUserId) {
        throw new ConflictException({
          code: 'AUTH_PROVIDER_LINKED',
          message: 'This provider account is linked to another user',
        });
      }
      return existingAccount.user;
    }

    // "Add method" intent with a new provider account: link it straight to
    // the requesting user (provider identity is already vouched by OAuth).
    if (linkUserId) {
      const linked = await this.prisma.db.user.findUnique({
        where: { id: linkUserId },
        select: OAUTH_USER_FIELDS,
      });
      if (linked) {
        // The provider's email must not already belong to a different account
        const linkEmail = input.email ? normalizeEmail(input.email) : undefined;
        if (linkEmail) {
          const linkEmailOwner = await this.prisma.db.user.findUnique({
            where: { email: linkEmail },
            select: { id: true },
          });
          if (linkEmailOwner && linkEmailOwner.id !== linkUserId) {
            throw new ConflictException({
              code: 'AUTH_EMAIL_TAKEN',
              message: 'That provider account uses an email already registered to another account',
            });
          }
        }

        await this.prisma.db.account.create({
          data: {
            id: crypto.randomUUID(),
            userId: linkUserId,
            provider: input.provider,
            providerAccountId: input.providerAccountId,
          },
        });

        // Announce the newly linked sign-in method to the user.
        await this.notifications
          .notify(linkUserId, 'profile_updated', { items: ['oauthAdd'] })
          .catch(() => {});

        return linked;
      }
      // The "add method" user can be missing (e.g. session outlived a DB wipe),
      // so fall through to a normal first-time login instead of linking a
      // non-existent userId (FK violation).
    }

    //  First time with this provider and the email already belongs to an
    //  existing user → REJECT. (The "add method" flow above is exempt.)
    const email = input.email ? normalizeEmail(input.email) : undefined;
    if (email) {
      const emailOwner = await this.prisma.db.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (emailOwner) {
        // Don't leak the exact owner : same generic message as register().
        throw new ConflictException(
          'This email is already being used. Use a different email or log in using the same method you used to create this account.',
        );
      }
    }

    // Create new. Provider-verified email fills the email field; without one
    // (GitHub/42), the account starts with an empty email, addable later via
    // Edit Profile.
    const username = await this.generateUniqueUsername(input.usernameSeed);
    const displayName = await this.generateUniqueDisplayName(username);
    const user = await this.prisma.db.user.create({
      data: {
        id: crypto.randomUUID(),
        username,
        displayName,
        email,
        emailVerified: email ? new Date() : null,
        achievement: { create: { id: crypto.randomUUID() } },
      },
      select: OAUTH_USER_FIELDS,
    });

    await this.prisma.db.account.create({
      data: {
        id: crypto.randomUUID(),
        userId: user.id,
        provider: input.provider,
        providerAccountId: input.providerAccountId,
      },
    });

    // Same seeding as register(): a fresh OAuth account has no photo either.
    await this.avatarMeta.set(user.id, { has: false, style: user.avatarStyle });

    return user;
  }

  // Signed 10-minute token carried in the OAuth `state` when a logged-in
  // user wants to ADD a provider sign-in method. It travels in a URL, so it
  // gets its own key and audience: it can never pass as a session token.
  createOAuthLinkToken(userId: string, provider: string): string {
    return this.jwt.sign(
      { sub: userId, p: provider, purpose: 'oauth-link' },
      {
        secret: requireSecret('OAUTH_STATE_SECRET'),
        audience: OAUTH_LINK_AUDIENCE,
        expiresIn: OAUTH_LINK_TTL,
      },
    );
  }

  // Verify a `state` token from the provider callback. Returns the userId
  // when it's ours and matches `provider`; anything else means normal login.
  resolveOAuthLinkForRequest(
    req: OAuthCallbackRequest | undefined,
    provider: string,
  ): string | undefined {
    const linkUserId = this.resolveOAuthLink(req?.query?.state, provider);
    if (!linkUserId) return undefined;
    const sessionUser = this.verifyAccessToken(
      typeof req?.cookies?.['token'] === 'string' ? req.cookies['token'] : undefined,
    );
    return sessionUser === linkUserId ? linkUserId : undefined;
  }

  // Signature check only : callers must use resolveOAuthLinkForRequest, which
  // also proves the presenter is the user named in the token.
  private resolveOAuthLink(state: unknown, provider: string): string | undefined {
    if (typeof state !== 'string' || !state) return undefined;
    try {
      const payload = this.jwt.verify<{ sub?: unknown; p?: string; purpose?: string }>(state, {
        secret: requireSecret('OAUTH_STATE_SECRET'),
        audience: OAUTH_LINK_AUDIENCE,
      });
      if (payload.purpose !== 'oauth-link' || payload.p !== provider) return undefined;
      return typeof payload.sub === 'string' && payload.sub ? payload.sub : undefined;
    } catch {
      return undefined;
    }
  }

  // Unlink a provider sign-in method. The user must keep at least one other
  // way to sign in : a password OR another linked provider.
  async removeOAuthMethod(userId: string, provider: string) {
    const account = await this.prisma.db.account.findFirst({ where: { userId, provider } });
    if (!account)
      throw new NotFoundException({
        code: 'AUTH_PROVIDER_NOT_LINKED',
        message: 'That provider is not linked to this account',
      });

    const user = await this.prisma.db.user.findUnique({ where: { id: userId } });
    if (!user)
      throw new UnauthorizedException({ code: 'USER_NOT_FOUND', message: 'User not found' });

    const remainingAccounts = await this.prisma.db.account.count({
      where: { userId, NOT: { provider } },
    });
    if (!user.password_hash && remainingAccounts === 0) {
      throw new ForbiddenException({
        code: 'AUTH_KEEP_ONE_SIGNIN',
        message: 'You must keep at least one sign-in method',
      });
    }

    await this.prisma.db.account.delete({ where: { id: account.id } });
    return { removed: provider };
  }

  // Turning usernames into unique seeds
  private async generateUniqueUsername(seed: string) {
    const base = seed.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 16) || 'user';
    let candidate = `${base}${this.randomSuffix()}`;
    while (await this.prisma.db.user.findUnique({ where: { username: candidate } })) {
      candidate = `${base}${this.randomSuffix()}`;
    }
    return candidate;
  }

  // Display names are unique too, so a freshly generated display name that
  // collides with an existing one also gets 5 random characters appended.
  private async generateUniqueDisplayName(seed: string) {
    const base = seed.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20) || 'user';
    let candidate = base;
    while (await this.prisma.db.user.findUnique({ where: { displayName: candidate } })) {
      candidate = `${base}_${this.randomChars(5)}`;
    }
    return candidate;
  }

  // 5 random alphanumeric characters (e.g. "3kF9z"). Avoids ambiguous
  // characters (0/O, 1/l/I) so generated suffixes are easy to read aloud.
  private randomChars(length: number): string {
    const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < length; i++) {
      out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return out;
  }
}
