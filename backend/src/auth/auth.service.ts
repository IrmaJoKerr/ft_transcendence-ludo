import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException, OnModuleDestroy, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import Redis from 'ioredis';
import { createRedis } from '../redis';
import { PrismaService } from '../prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { JwtPayload } from './jwt-payload';
import { MailService } from './mail.service';
import { TwoFactorService } from './twofactor.service';
import { SessionService } from './session.service';
import { secret } from '../secrets';
import { NotificationService } from '../notification/notification.service';

const SALT_ROUNDS = 10;
// A display name can be changed at most once every 2 hours.
const DISPLAY_NAME_CHANGE_COOLDOWN_S = 2 * 60 * 60;
// Also where the SPA lives; /api on the same origin reaches the backend
// through whichever proxy (nginx or Vite) is serving it.
const BASE_URL = secret('FRONTEND_URL') ?? 'https://localhost:8443';

// store all email as lowercase since email is case-insensitive
const normalizeEmail = (email: string) => email.trim().toLowerCase();

// convert at read/display time
const formatVerifiedAt = (date: Date) =>
  new Intl.DateTimeFormat('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);

// login()'s two outcomes, depending on the user's 2FA preference. The explicit
// union lets the controller narrow on `twoFactorRequired` cleanly.
type LoginResult =
  | { twoFactorRequired: true; pendingToken: string }
  | {
      twoFactorRequired: false;
      accessToken: string;
      refreshToken: string;
      user: { id: string; username: string; displayName: string };
    };

@Injectable()
export class AuthService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly twoFactor: TwoFactorService,
    private readonly session: SessionService,
    private readonly notifications: NotificationService,
  ) {
    // Small Redis client for account-deletion cleanup (same idiom as
    // FriendsService / MatchPlayerService).
    this.redis = createRedis();
    this.redis.on('error', (error) => console.error('Auth Redis error:', (error as Error).message));
  }

  onModuleDestroy() {
    this.redis.quit();
  }

  async register(dto: RegisterDto, baseUrl: string = BASE_URL) {
    const existing = await this.prisma.db.user.findUnique({ where: { username: dto.username } });
    if (existing) {
      throw new ConflictException('Username is already taken');
    }

    const email = dto.email ? normalizeEmail(dto.email) : dto.email;
    if (email) {
      const emailTaken = await this.prisma.db.user.findUnique({ where: { email } });
      if (emailTaken) {
        throw new ConflictException('Email already registered. Use a different email');
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await this.prisma.db.user.create({
      data: {
        id: crypto.randomUUID(),
        username: dto.username,
        displayName: dto.username,
        email,
        password_hash: passwordHash,
        achievement: { create: { id: crypto.randomUUID() } },
      },
    });

    // No session yet, the account activates via the emailed link.
    const token = await this.twoFactor.createVerifyToken(user.id);
    await this.mail.sendVerification(
      user.email!,
      `${baseUrl}/api/auth/verify-email?token=${token}`,
    );
    return { message: 'Account created — check your email to verify your address.' };
  }

  /* Redeems a signup verification link. Returns false for unknown/expired tokens. */
  async verifyEmail(token: string): Promise<boolean> {
    const userId = await this.twoFactor.consumeVerifyToken(token);
    if (!userId) return false;
    const user = await this.prisma.db.user.update({
      where: { id: userId },
      data: { emailVerified: new Date() },
    });
    console.log(`Email verified for ${user.username} at ${formatVerifiedAt(user.emailVerified!)}`);
    return true;
  }

  async login(dto: LoginDto): Promise<LoginResult> {
    // Accept either a username or an email in the same field.
    const user = await this.prisma.db.user.findFirst({
      where: {
        OR: [
          { username: dto.identifier },
          { email: normalizeEmail(dto.identifier) },
        ],
      },
    });
    if (!user || !user.password_hash) {
      throw new UnauthorizedException('Invalid username, email, or password');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.password_hash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid username, email, or password');
    }

    if (!user.emailVerified) {
      throw new ForbiddenException('Email not verified — open the link we sent you first');
    }

    // 2FA off → password alone is enough; issue the session immediately.
    // 2FA on → password is only factor one; email a code and finish later.
    if (!user.twoFactorEnabled) {
      return { twoFactorRequired: false as const, ...(await this.issueSession(user.id, user.username)) };
    }
    const { pendingToken } = await this.startTwoFactor(user.id, user.email!);
    return { twoFactorRequired: true as const, pendingToken };
  }

  /*
   * Step one of reset: email a one-time link if the address belongs to a local
   * (password) account. The return value is intentionally the same in every
   * case — unknown email, OAuth-only account, or success — so a caller can't
   * use this endpoint to discover which emails are registered.
   */
  async forgotPassword(rawEmail: string, baseUrl: string = BASE_URL) {
    const email = normalizeEmail(rawEmail);
    const user = await this.prisma.db.user.findUnique({ where: { email } });
    // Only local accounts have a password to reset; OAuth-only users (no
    // password_hash) sign in through their provider instead.
    if (user?.password_hash) {
      const token = await this.twoFactor.createResetToken(user.id);
      await this.mail.sendPasswordReset(email, `${baseUrl}/reset-password?token=${token}`);
    }
    return { message: 'If that email is registered, a reset link is on its way.' };
  }

  /* Step two: redeem the link's token and set the new password. */
  async resetPassword(token: string, newPassword: string) {
    const userId = await this.twoFactor.consumeResetToken(token);
    if (!userId) {
      throw new UnauthorizedException('This reset link is invalid or has expired');
    }
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await this.prisma.db.user.update({
      where: { id: userId },
      data: {
        password_hash: passwordHash,
        // Redeeming an emailed link proves inbox control — the same guarantee
        // signup verification gives — so confirm the address if it wasn't yet.
        // Without this, an unverified user could reset yet still be login-blocked.
        emailVerified: new Date(),
      },
    });
    // drop every existing session after a password reset
    await this.session.revokeAll(userId);

    // Announce the password reset to the user (persisted — lands in the bell
    // on their next sign-in, since this flow revokes all open sessions).
    await this.notifications
      .notify(userId, 'profile_updated', { items: ['password'] })
      .catch(() => {});

    return { message: 'Password updated — you can log in with it now.' };
  }

  /* Factor two: email a one-time code, hand back the challenge reference. */
  async startTwoFactor(userId: string, email: string) {
    const { pendingToken, code } = await this.twoFactor.startChallenge(userId);
    await this.mail.send2faCode(email, code);
    return { pending: true as const, pendingToken };
  }

  async completeTwoFactor(pendingToken: string, code: string) {
    const userId = await this.twoFactor.verifyChallenge(pendingToken, code);
    if (!userId) {
      throw new UnauthorizedException('Invalid or expired code');
    }
    const user = await this.prisma.db.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Invalid or expired code');
    }
    return this.issueSession(user.id, user.username);
  }

  /** Sign a short-lived access-token JWT (15m, per JwtModule config). */
  signAccess(userId: string, username: string): string {
    const payload: JwtPayload = { sub: userId, username };
    return this.jwt.sign(payload);
  }

  /**
   * Issue a fresh session: a short-lived access token plus a long-lived,
   * revocable refresh token. Called once both login factors pass (password
   * login and OAuth both funnel through completeTwoFactor).
   */
  async issueSession(userId: string, username: string) {
    const accessToken = this.signAccess(userId, username);
    const refreshToken = await this.session.issue(userId);
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });
    return {
      accessToken,
      refreshToken,
      user: { id: userId, username, displayName: user?.displayName ?? username },
    };
  }

  /**
   * Trade a valid refresh token for a new access token, rotating the refresh
   * token in the same step. Throws 401 when it's missing/expired/revoked — the
   * frontend reads that as "session over, log in again".
   */
  async refresh(refreshToken?: string) {
    if (!refreshToken) throw new UnauthorizedException('Not authenticated');
    const rotated = await this.session.rotate(refreshToken);
    if (!rotated) throw new UnauthorizedException('Session expired — please log in again');
    const user = await this.prisma.db.user.findUnique({ where: { id: rotated.userId } });
    if (!user) throw new UnauthorizedException('Session expired — please log in again');
    return {
      accessToken: this.signAccess(user.id, user.username),
      refreshToken: rotated.newToken,
      user: { id: user.id, username: user.username, displayName: user.displayName },
    };
  }

  /** Revoke the given refresh token — logout on this device. */
  async logout(refreshToken?: string) {
    if (refreshToken) await this.session.revoke(refreshToken);
  }

  /** Full profile for the Edit-Profile card (incl. linked OAuth providers). */
  async getProfile(userId: string) {
    const user = await this.prisma.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    const accounts = await this.prisma.db.account.findMany({
      where: { userId },
      select: { provider: true },
    });
    return {
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        hasPassword: !!user.password_hash,
        avatarStyle: user.avatarStyle,
        hasAvatarPhoto: user.avatarPhotoContentType !== null,
        providers: accounts.map((a) => a.provider),
      },
    };
  }

  /** Validates a short-lived access-token JWT (the `token` cookie). Returns the
   *  user id when valid, else null. Used to confirm an OAuth callback is a
   *  genuine "add method" round-trip from an already-authenticated browser. */
  verifyAccessToken(token: string | undefined): string | null {
    if (!token) return null;
    try {
      const payload = this.jwt.verify(token) as { sub?: string };
      return payload.sub ?? null;
    } catch {
      return null;
    }
  }

  /** Read the user's current 2FA preference. */
  async getTwoFactorSetting(userId: string) {
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { twoFactorEnabled: true },
    });
    if (!user) throw new UnauthorizedException('User not found');
    return { twoFactorEnabled: user.twoFactorEnabled };
  }

  /** Turn email-code 2FA on or off for the user. */
  async setTwoFactorSetting(userId: string, enabled: boolean) {
    await this.prisma.db.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: enabled },
    });
    return { twoFactorEnabled: enabled };
  }

  /**
   * Complete profile update — edit display name, email, and/or the email-code
   * 2FA method in one call. Only provided fields change.
   *
   * The username is auto-generated and cannot be changed; only the display
   * name is editable.
   *
   * Email changes REUSE the signup verification path: the new address is
   * saved, `emailVerified` is cleared (the login gate requires a verified
   * address), and a fresh verification link is emailed via the same
   * createVerifyToken → sendVerification flow as register().
   */
  async updateProfile(
    userId: string,
    dto: {
      displayName?: string;
      email?: string;
      twoFactorEnabled?: boolean;
      oauthToAdd?: string;
      oauthToRemove?: string;
    },
  ) {
    const user = await this.prisma.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    const data: Record<string, unknown> = {};
    let emailChanged = false;
    let newEmail: string | undefined;
    // Items actually changed in this request — feeds the profile_updated toast.
    const changedItems: string[] = [];

    if (dto.displayName !== undefined && dto.displayName !== user.displayName) {
      // Cooldown: a display name can be changed at most once every 2 hours.
      const cooldownTtl = await this.redis.ttl(`dnChange:${userId}`);
      if (cooldownTtl > 0) {
        const minutes = Math.ceil(cooldownTtl / 60);
        throw new HttpException(
          `Display name change limit reached. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      const taken = await this.prisma.db.user.findUnique({
        where: { displayName: dto.displayName },
      });
      if (taken) throw new ConflictException('Display name is already taken');
      data.displayName = dto.displayName;
    }

    if (dto.email !== undefined) {
      const email = normalizeEmail(dto.email);
      if (email !== user.email) {
        const emailTaken = await this.prisma.db.user.findUnique({ where: { email } });
        if (emailTaken) {
          throw new ConflictException('Email already registered. Use a different email');
        }
        data.email = email;
        // New address must be re-confirmed before it can be used to log in.
        data.emailVerified = null;
        emailChanged = true;
        newEmail = email;
      }
    }

    if (dto.twoFactorEnabled !== undefined) {
      data.twoFactorEnabled = dto.twoFactorEnabled;
    }

    // OAuth: remove a linked sign-in method (lockout-guarded).
    if (dto.oauthToRemove !== undefined) {
      await this.removeOAuthMethod(userId, dto.oauthToRemove);
      changedItems.push('oauthRemove');
    }

    // OAuth: adding a method needs the browser round-trip — mint a 10m
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

    // Start the display-name cooldown only AFTER a successful change, so a
    // failed save (e.g. email conflict) doesn't burn the user's one change.
    if (data.displayName !== undefined) {
      await this.redis
        .set(`dnChange:${userId}`, '1', 'EX', DISPLAY_NAME_CHANGE_COOLDOWN_S)
        .catch(() => {});
    }

    // Email change → auto-send a fresh verification link (reuse register's path).
    if (emailChanged && newEmail) {
      const token = await this.twoFactor.createVerifyToken(userId);
      await this.mail.sendVerification(newEmail, `${BASE_URL}/api/auth/verify-email?token=${token}`);
    }

    // ── Profile-change notifications ─────────────────────────────────────────
    // 1) Self-confirmation (persisted): "You have updated your profile: …"
    if (data.displayName !== undefined) changedItems.push('displayName');
    if (emailChanged) changedItems.push('email');
    if (dto.twoFactorEnabled !== undefined && dto.twoFactorEnabled !== user.twoFactorEnabled) {
      changedItems.push('twoFactor');
    }
    if (changedItems.length > 0) {
      await this.notifications
        .notify(userId, 'profile_updated', { items: changedItems })
        .catch(() => {});
    }

    // 2) Global announcement (transient toast, all online users):
    //    "(Old DisplayName) has changed their Displayname to (New DisplayName)"
    if (data.displayName !== undefined) {
      await this.notifications
        .broadcast('display_name_changed', {
          fromUserId: userId,
          fromUsername: user.username,
          oldDisplayName: user.displayName,
          displayName: dto.displayName,
        })
        .catch(() => {});
    }

    const accounts = await this.prisma.db.account.findMany({
      where: { userId },
      select: { provider: true },
    });

    return {
      user: {
        id: updated.id,
        username: updated.username,
        displayName: updated.displayName,
        email: updated.email,
        hasPassword: !!updated.password_hash,
        providers: accounts.map((a) => a.provider),
      },
      emailVerificationSent: emailChanged,
      oauthRedirectUrl,
    };
  }

  /**
   * Logged-in password change: verify the current password, then set the new
   * one and keep the CURRENT device signed in while revoking every other session.
   * OAuth-only accounts have no password_hash — they set their FIRST password
   * here, so `currentPassword` is only checked when one already exists.
   */
  async changePassword(userId: string, currentPassword: string | undefined, newPassword: string, currentRefreshToken?: string) {
    const user = await this.prisma.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    if (user.password_hash) {
      const matches = await bcrypt.compare(currentPassword ?? '', user.password_hash);
      if (!matches) throw new UnauthorizedException('Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await this.prisma.db.user.update({
      where: { id: userId },
      data: { password_hash: passwordHash },
    });

    // Log the user out everywhere — other devices must re-auth with the new password.
    await this.session.revokeAllExcept(userId, currentRefreshToken);

    await this.notifications
      .notify(userId, 'profile_updated', { items: ['password'] })
      .catch(() => {});

    return { message: 'Password updated — other devices were signed out.' };
  }

  /**
   * Permanently delete the authenticated user's account.
   *
   * Guard rails:
   *  - `confirm` must be true.
   *  - A password is ALWAYS required at deletion time. Accounts without one
   *    (OAuth-only) must set a first password via changePassword first — that
   *    gives the deletion a real credential to verify against.
   *
   * Order matters — DB delete is LAST: everything before it is best-effort
   * cleanup, so if any step fails the account is untouched. The DB delete is
   * the single point of no return.
   */
  async deleteAccount(userId: string, dto: DeleteAccountDto) {
    if (!dto.confirm) throw new BadRequestException('You must confirm account deletion');

    const user = await this.prisma.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    if (!user.password_hash) {
      throw new ForbiddenException('Set a password before deleting your account');
    }
    const matches = await bcrypt.compare(dto.currentPassword ?? '', user.password_hash);
    if (!matches) throw new UnauthorizedException('Current password is incorrect');

    // 1. Abort live matches the user is seated in, so a deleted user_id can
    //    never FK-fail processGameEnd and void the opponents' results.
    await this.abortUserMatches(userId);

    // 2. Drop ephemeral Redis state (presence, invites, leaderboard entries).
    await this.clearUserRedisState(userId);

    // 3. Revoke every refresh session — all devices are logged out.
    await this.session.revokeAll(userId);

    // 4. DB: LeaderboardSnapshot has no FK to User, so delete it explicitly;
    //    user.delete() cascades Account/Achievement/GameParticipant/Friendship/
    //    Notification (all onDelete: Cascade in the schema).
    await this.prisma.db.$transaction([
      this.prisma.db.leaderboardSnapshot.deleteMany({ where: { userId } }),
      this.prisma.db.user.delete({ where: { id: userId } }),
    ]);

    return { message: 'Account permanently deleted' };
  }

  /** Mark every WAITING/ACTIVE match the user is seated in as ABORTED (1h TTL). */
  private async abortUserMatches(userId: string): Promise<void> {
    try {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', 'match:*', 'COUNT', 100);
        cursor = nextCursor;
        for (const key of keys) {
          const data = await this.redis.hgetall(key);
          const seated = [data.player1_id, data.player2_id, data.player3_id, data.player4_id].includes(userId);
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

  /** Remove the user's ephemeral Redis state (presence, invites, leaderboard). */
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

  /**
   * Called after a provider (Google/GitHub) has verified the user.
   * Finds the matching user, or links/creates one, then returns it.
   */
  async validateOAuthLogin(
    input: {
      provider: string;
      providerAccountId: string;
      email?: string;
      usernameSeed: string;
    },
    linkUserId?: string,
  ) {
    // EMAIL OWNERSHIP RULE: a provider's email may only set the account's
    // `email` + `emailVerified` during the FIRST sign-in (new account, or an
    // OAuth login matched by email). The "add sign-in method" flow below
    // (linkUserId) deliberately ignores the provider's email entirely — e.g.
    // an account created with Google (123@gmail.com) that links 42
    // (4321@42.com) keeps 123@gmail.com and its verification state.

    // If provider account exist just log them in
    const existingAccount = await this.prisma.db.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider: input.provider,
          providerAccountId: input.providerAccountId,
        },
      },
      include: { user: true },
    });
    if (existingAccount) {
      // "Add method" intent: same user -> no-op, different user -> conflict.
      if (linkUserId && existingAccount.userId !== linkUserId) {
        throw new ConflictException('This provider account is linked to another user');
      }
      return existingAccount.user;
    }

    // "Add method" intent with a new provider account: link it straight to
    // the requesting user (provider identity is already vouched by OAuth).
    if (linkUserId) {
      const linked = await this.prisma.db.user.findUnique({ where: { id: linkUserId } });
      if (linked) {
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
      // The "add method" user no longer exists — e.g. this browser's session
      // survived a DB reset/wipe (db push --accept-data-loss). Don't try to
      // link a provider to a ghost userId (that would throw an FK violation);
      // fall through and treat this OAuth callback as a normal first-time login.
    }

    //  If first time with this provider, and the email matches an existing
    //  user, REJECT the OAuth login — the email already belongs to another
    //  account. (The "add sign-in method" flow above is exempt: it never
    //  claims the provider's email for the account.)
    const email = input.email ? normalizeEmail(input.email) : undefined;
    if (email) {
      const emailOwner = await this.prisma.db.user.findUnique({ where: { email } });
      if (emailOwner) {
        // Don't leak the exact owner — same generic message as register().
        throw new ConflictException(
          'This email is already being used. Use a different email or log in using the same method you used to create this account.',
        );
      }
    }

    // Create new — the provider-verified email populates the email field; if
    // the provider returned no email (GitHub/42 with no verified address), the
    // account is still created with an empty email and the user can add one
    // later via Edit Profile.
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
    });

    await this.prisma.db.account.create({
      data: {
        id: crypto.randomUUID(),
        userId: user.id,
        provider: input.provider,
        providerAccountId: input.providerAccountId,
      },
    });

    return user;
  }

  /**
   * Issue a short-lived signed token carried in the OAuth `state` field when a
   * logged-in user wants to ADD a provider sign-in method. 10m bounds how long
   * an abandoned connect flow stays valid.
   */
  createOAuthLinkToken(userId: string, provider: string): string {
    return this.jwt.sign({ sub: userId, p: provider, purpose: 'oauth-link' }, { expiresIn: '10m' });
  }

  /**
   * Verify a `state` token returned by the provider callback. Returns the
   * userId when the token is ours and matches `provider`, else undefined (a
   * missing/foreign state is treated as a normal login, never a link).
   */
  resolveOAuthLink(state: string | string[] | undefined, provider: string): string | undefined {
    if (typeof state !== 'string' || !state) return undefined;
    try {
      const payload = this.jwt.verify(state) as { sub?: string; p?: string; purpose?: string };
      if (payload.purpose !== 'oauth-link' || payload.p !== provider) return undefined;
      return payload.sub;
    } catch {
      return undefined;
    }
  }

  /**
   * Unlink a provider sign-in method. Lockout guard: the user must keep at
   * least one other way to sign in — a password OR another linked provider.
   */
  async removeOAuthMethod(userId: string, provider: string) {
    const account = await this.prisma.db.account.findFirst({ where: { userId, provider } });
    if (!account) throw new NotFoundException('That provider is not linked to this account');

    const user = await this.prisma.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    const remainingAccounts = await this.prisma.db.account.count({
      where: { userId, NOT: { provider } },
    });
    if (!user.password_hash && remainingAccounts === 0) {
      throw new ForbiddenException('You must keep at least one sign-in method');
    }

    await this.prisma.db.account.delete({ where: { id: account.id } });
    return { removed: provider };
  }

  // Turning usernames into unique seeds
  private async generateUniqueUsername(seed: string) {
    const base = seed.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20) || 'user';
    let candidate = base;
    while (await this.prisma.db.user.findUnique({ where: { username: candidate } })) {
      candidate = `${base}_${this.randomChars(5)}`;
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
