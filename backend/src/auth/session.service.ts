import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { createHash, randomBytes } from 'node:crypto';
import { secret } from '../secrets';

const REFRESH_TTL_S = 7 * 24 * 60 * 60; // refresh tokens live 7 days

@Injectable()
// Refresh-token session store in Redis: minting, rotation and revocation of
// the 7-day refresh tokens that back the 15-min JWT access tokens. Used by
// auth.service.ts (login, refresh, logout, password reset).
export class SessionService implements OnModuleDestroy {
  // Redis client holding refresh:<sha256(token)> -> userId, plus a
  // sessions:<userId> set indexing all of a user's live sessions.
  private redis: Redis;

  constructor() {
    const host = process.env.REDIS_HOST || 'redis';
    const port = parseInt(process.env.REDIS_PORT || '6479', 10);
    const password = secret('REDIS_PASSWORD');
    this.redis = new Redis({ host, port, password, retryStrategy: (t) => Math.min(t * 50, 2000) });
    this.redis.on('error', (error) => console.error('Redis error:', (error as Error).message));
  }

  onModuleDestroy() {
    this.redis.quit();
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  // Mint a new refresh token for a user and record it as a live session.
  async issue(userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const h = this.hash(token);
    await this.redis.set(`refresh:${h}`, userId, 'EX', REFRESH_TTL_S);
    // Track it under the user so resetPassword can revoke every session at once.
    await this.redis.sadd(`sessions:${userId}`, h);
    await this.redis.expire(`sessions:${userId}`, REFRESH_TTL_S); // keep the index alive as long as any session
    return token;
  }

  // Verify a refresh token and rotate it: the old token is consumed and a
  // fresh one issued in the same step. Returns userId + new token, or null.
  async rotate(oldToken: string): Promise<{ userId: string; newToken: string } | null> {
    const oldHash = this.hash(oldToken);
    const userId = await this.redis.get(`refresh:${oldHash}`);
    if (!userId) return null;

    await this.redis.del(`refresh:${oldHash}`);
    await this.redis.srem(`sessions:${userId}`, oldHash);

    const newToken = await this.issue(userId);
    return { userId, newToken };
  }

  // Revoke a single session (logout on this device).
  async revoke(token: string): Promise<void> {
    const h = this.hash(token);
    const userId = await this.redis.get(`refresh:${h}`);
    await this.redis.del(`refresh:${h}`);
    if (userId) await this.redis.srem(`sessions:${userId}`, h);
  }

  // Revoke every session a user has (e.g. after a password reset).
  async revokeAll(userId: string): Promise<void> {
    const hashes = await this.redis.smembers(`sessions:${userId}`);
    const keys = hashes.map((h) => `refresh:${h}`);
    if (keys.length) await this.redis.del(...keys);
    await this.redis.del(`sessions:${userId}`);
  }

  // Revoke every session EXCEPT the one carrying `keepToken`.
  async revokeAllExcept(userId: string, keepToken: string | undefined): Promise<void> {
    const keepHash = keepToken ? this.hash(keepToken) : undefined;
    const hashes = await this.redis.smembers(`sessions:${userId}`);
    const revokeHashes = hashes.filter((h) => h !== keepHash);
    if (!keepHash) await this.redis.del(`sessions:${userId}`);
    // SREM with no members (single-session user, e.g. setting a first password
    // from the only logged-in device) is a Redis protocol error : guard it.
    else if (revokeHashes.length > 0) await this.redis.srem(`sessions:${userId}`, ...revokeHashes);
    const keys = revokeHashes.map((h) => `refresh:${h}`);
    if (keys.length) await this.redis.del(...keys);
  }
}


// Session flow: the client gets a JWT (15 min) + refresh token (7 days) as
// httpOnly cookies. On a 401, apiFetch POSTs /api/auth/refresh with the refresh
// cookie; the server validates the hash in Redis, rotates both tokens, and
// apiFetch retries the original request.
