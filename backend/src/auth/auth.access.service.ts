import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type Redis from 'ioredis';
import { publishMatchAbandon } from '../common/channels';
import { REDIS_CLIENT } from '../common/redis-client';
import { findLiveMatch } from '../match/active-game';
import { PrismaService } from '../prisma.service';
import { AUTH } from './auth.constants';
import type { PublicUser, UserRow } from './auth.shared';
import type { JwtPayload } from './jwt-payload';
import { SessionService } from './session.service';
import { TwoFactorService } from './twofactor.service';

// Session plumbing: access token, refresh rotation, PublicUser and cleanup counters.
// Registration, profile and OAuth all need these, so they live together.
@Injectable()
export class AuthAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly session: SessionService,
    private readonly twoFactor: TwoFactorService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // Per-user rolling-hour cap on email-address changes (Redis INCR, TTL = window).
  async enforceEmailChangeLimit(userId: string): Promise<void> {
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
  async publicUser(user: UserRow): Promise<PublicUser> {
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
}
