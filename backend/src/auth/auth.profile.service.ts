import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import type Redis from 'ioredis';
import { AvatarMetaService } from '../avatar/avatar-meta.service';
import { isReservedBotName } from '../common/botname-enforce';
import { REDIS_CLIENT } from '../common/redis-client';
import { FriendshipEventsService } from '../friends/friendship-events.service';
import { matchSeatIds } from '../match/active-game';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma.service';
import { AuthAccessService } from './auth.access.service';
import { AuthOAuthService } from './auth.oauth.service';
import { BASE_URL, SALT_ROUNDS, normalizeEmail } from './auth.shared';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { MailService } from './mail.service';
import { SessionService } from './session.service';
import { TwoFactorService } from './twofactor.service';

// The signed-in account's own data: the profile card, profile edits (including the
// email-change handshake and OAuth method changes), password, and deletion. Reads
// the live match hash only to abort a deleted user's seats before the row goes.
@Injectable()
export class AuthProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly twoFactor: TwoFactorService,
    private readonly session: SessionService,
    private readonly notifications: NotificationService,
    private readonly avatarMeta: AvatarMetaService,
    private readonly friendshipEvents: FriendshipEventsService,
    private readonly mail: MailService,
    private readonly access: AuthAccessService,
    private readonly oauth: AuthOAuthService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

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

    return { user: await this.access.publicUser(user) };
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
      await this.access.enforceEmailChangeLimit(userId);
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
      await this.oauth.removeOAuthMethod(userId, dto.oauthToRemove);
      changedItems.push('oauthRemove');
    }

    // OAuth: adding a method needs the browser round-trip : mint a 10m
    // oauth-link token and hand back the provider authorize URL with it in
    // `state`; the callback then links the provider to this user.
    let oauthRedirectUrl: string | undefined;
    if (dto.oauthToAdd !== undefined) {
      const state = this.oauth.createOAuthLinkToken(userId, dto.oauthToAdd);
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
      user: await this.access.publicUser(updated),
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
}
