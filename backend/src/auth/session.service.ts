import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { createRedis } from '../redis';
import { createHash, randomBytes } from 'node:crypto';
import { secret } from '../secrets';

const REFRESH_TTL_S = 7 * 24 * 60 * 60; // refresh tokens live 7 days

@Injectable()
export class SessionService implements OnModuleDestroy {
  private redis: Redis;

  constructor() {
    this.redis = createRedis();
    this.redis.on('error', (error) => console.error('Redis error:', (error as Error).message));
  }

  onModuleDestroy() {
    this.redis.quit();
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  /** Mint a new refresh token for a user and record it as a live session. */
  async issue(userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const h = this.hash(token);
    await this.redis.set(`refresh:${h}`, userId, 'EX', REFRESH_TTL_S);
    // Track it under the user so resetPassword can revoke every session at once.
    await this.redis.sadd(`sessions:${userId}`, h);
    await this.redis.expire(`sessions:${userId}`, REFRESH_TTL_S); // keep the index alive as long as any session
    return token;
  }

  /**
   * Verify a refresh token and rotate it: the old token is consumed and a fresh
   * one issued in the same step. Returns the userId + new token, or null when
   * the token is unknown/expired. Rotation means a stolen-then-rotated token
   * stops working, shrinking the window a leak is useful.
   */
  async rotate(oldToken: string): Promise<{ userId: string; newToken: string } | null> {
    const oldHash = this.hash(oldToken);
    const userId = await this.redis.get(`refresh:${oldHash}`);
    if (!userId) return null;

    await this.redis.del(`refresh:${oldHash}`);
    await this.redis.srem(`sessions:${userId}`, oldHash);

    const newToken = await this.issue(userId);
    return { userId, newToken };
  }

  /** Revoke a single session (logout on this device). */
  async revoke(token: string): Promise<void> {
    const h = this.hash(token);
    const userId = await this.redis.get(`refresh:${h}`);
    await this.redis.del(`refresh:${h}`);
    if (userId) await this.redis.srem(`sessions:${userId}`, h);
  }

  /** Revoke every session a user has (e.g. after a password reset). */
  async revokeAll(userId: string): Promise<void> {
    const hashes = await this.redis.smembers(`sessions:${userId}`);
    const keys = hashes.map((h) => `refresh:${h}`);
    if (keys.length) await this.redis.del(...keys);
    await this.redis.del(`sessions:${userId}`);
  }

  /** Revoke every session EXCEPT the one carrying `keepToken`. */
  async revokeAllExcept(userId: string, keepToken: string | undefined): Promise<void> {
    const keepHash = keepToken ? this.hash(keepToken) : undefined;
    const hashes = await this.redis.smembers(`sessions:${userId}`);
    const revokeHashes = hashes.filter((h) => h !== keepHash);
    if (!keepHash) await this.redis.del(`sessions:${userId}`);
    // SREM with no members (single-session user, e.g. setting a first password
    // from the only logged-in device) is a Redis protocol error — guard it.
    else if (revokeHashes.length > 0) await this.redis.srem(`sessions:${userId}`, ...revokeHashes);
    const keys = revokeHashes.map((h) => `refresh:${h}`);
    if (keys.length) await this.redis.del(...keys);
  }
}


/*
Right now my client will receive a JWT (15-min expiry) and a raw refresh token (7-day expiry),
both as httpOnly cookies. Once the JWT expires, a protected request returns 401. apiFetch catches
that and POSTs to /api/auth/refresh; the browser automatically attaches the raw refresh token
cookie. The server hashes that token and looks up the hash in Redis — if it's there and unexpired,
the server issues a new JWT and a new raw refresh token (deleting the old hash, storing the new one — rotation),
and sends both back as fresh cookies. apiFetch then retries the original request.
*/
