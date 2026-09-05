import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { createRedis } from '../redis';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { secret } from '../secrets';

const VERIFY_TOKEN_TTL_S = 24 * 60 * 60; // signup verification links: 24h
const RESET_TOKEN_TTL_S = 60 * 60; //      password-reset links: 1 hour
const CODE_TTL_S = 5 * 60; //              login codes: 5 minutes
const MAX_ATTEMPTS = 5;

/**
 * Short-lived auth state in Redis (same client idiom as MatchService):
 *  - `verify:{sha256(token)}` -> userId       — email-verification links
 *  - `reset:{sha256(token)}`  -> userId       — password-reset links
 *  - `2fa:{sha256(pending)}`  -> {userId, codeHash, attempts} — login codes
 *
 * Only hashes are stored, so a Redis dump can't be replayed as live tokens.
 * TTLs make expiry automatic — nothing to clean up.
 */
@Injectable()
export class TwoFactorService implements OnModuleDestroy {
  private redis: Redis;

  constructor() {
    // Connection comes from REDIS_URL (managed Redis, e.g. Upstash) or the
    // classic host/port/password env — see ../redis.ts.
    this.redis = createRedis();
    this.redis.on('error', (error) => console.error('Redis error:', (error as Error).message));
  }

  onModuleDestroy() {
    this.redis.quit();
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  // ── Email-verification tokens ─────────────────────────────────────────────

  async createVerifyToken(userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await this.redis.set(`verify:${this.hash(token)}`, userId, 'EX', VERIFY_TOKEN_TTL_S);
    return token;
  }

  /** Returns the userId and deletes the token (single use), or null. */
  async consumeVerifyToken(token: string): Promise<string | null> {
    const key = `verify:${this.hash(token)}`;
    const userId = await this.redis.get(key);
    if (userId) await this.redis.del(key);
    return userId;
  }

  // ── Password-reset tokens ─────────────────────────────────────────────────

  async createResetToken(userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await this.redis.set(`reset:${this.hash(token)}`, userId, 'EX', RESET_TOKEN_TTL_S);
    return token;
  }

  /** Returns the userId and deletes the token (single use), or null. */
  async consumeResetToken(token: string): Promise<string | null> {
    const key = `reset:${this.hash(token)}`;
    const userId = await this.redis.get(key);
    if (userId) await this.redis.del(key);
    return userId;
  }

  // ── Login (2FA) challenges ────────────────────────────────────────────────

  async startChallenge(userId: string): Promise<{ pendingToken: string; code: string }> {
    const pendingToken = randomBytes(32).toString('hex');
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const key = `2fa:${this.hash(pendingToken)}`;
    await this.redis.hset(key, { userId, codeHash: this.hash(code), attempts: 0 });
    await this.redis.expire(key, CODE_TTL_S);
    return { pendingToken, code };
  }

  /** Returns the userId when the code matches (challenge consumed), else null. */
  async verifyChallenge(pendingToken: string, code: string): Promise<string | null> {
    const key = `2fa:${this.hash(pendingToken)}`;
    const data = await this.redis.hgetall(key);
    if (!data?.userId) return null; // unknown or expired

    if (parseInt(data.attempts ?? '0', 10) >= MAX_ATTEMPTS) {
      await this.redis.del(key); // burn the challenge — brute-force cap
      return null;
    }
    if (this.hash(code) !== data.codeHash) {
      await this.redis.hincrby(key, 'attempts', 1);
      return null;
    }

    await this.redis.del(key); // single use
    return data.userId;
  }
}
