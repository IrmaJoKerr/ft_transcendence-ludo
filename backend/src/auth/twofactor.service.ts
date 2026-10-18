import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { secret } from '../secrets';
import { AUTH } from './auth.constants';

const VERIFY_TOKEN_TTL_S = AUTH.verifyTokenTtlS; // signup verification links
const RESET_TOKEN_TTL_S = AUTH.resetTokenTtlS; //  password-reset links
const CHANGE_TTL_S = AUTH.changeTokenTtlS; //      email-change links
const CODE_TTL_S = AUTH.challenge.ttlS; //         login codes
const MAX_ATTEMPTS = AUTH.challenge.maxAttempts;
const RESEND_WINDOW_S = AUTH.challenge.resendWindowS; // resend cap window
const MAX_RESENDS = AUTH.challenge.maxResends;

// Short-lived auth state in Redis: hashed tokens with auto-expiry. Keys are
// `verify:`/`reset:` (links), `2fa:` (login codes), `emailchange:` (staged
// changes) and `emailchange:user:<userId>` (reverse pointer, watched by MailService).
@Injectable()
export class TwoFactorService implements OnModuleDestroy {
  // Redis client for all short-lived auth state (verify/reset/2FA keys).
  private redis: Redis;

  constructor() {
    // Host/port stay plain env : they're topology, not secrets.
    const host = process.env.REDIS_HOST ?? 'redis';
    const port = parseInt(process.env.REDIS_PORT ?? '6479', 10);
    const password = secret('REDIS_PASSWORD');

    this.redis = new Redis({ host, port, password, retryStrategy: (t) => Math.min(t * 50, 2000) });
    this.redis.on('error', (error) => {
      console.error('Redis error:', error.message);
    });
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  // Generate a fresh 6-digit code and (re)store it on a `2fa:` challenge: hashed,
  // attempts reset, TTL refreshed. Shared by startChallenge + resendChallenge.
  private async issueCode(key: string): Promise<string> {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.redis.hset(key, { codeHash: this.hash(code), attempts: 0 });
    await this.redis.expire(key, CODE_TTL_S);
    return code;
  }

  // Email-verification tokens
  async createVerifyToken(userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await this.redis.set(`verify:${this.hash(token)}`, userId, 'EX', VERIFY_TOKEN_TTL_S);
    return token;
  }

  // Returns the userId and deletes the token (single use), or null.
  async consumeVerifyToken(token: string): Promise<string | null> {
    const key = `verify:${this.hash(token)}`;
    const userId = await this.redis.get(key);
    if (userId) await this.redis.del(key);
    return userId;
  }

  // Password-reset tokens
  async createResetToken(userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await this.redis.set(`reset:${this.hash(token)}`, userId, 'EX', RESET_TOKEN_TTL_S);
    return token;
  }

  // Returns the userId and deletes the token (single use), or null.
  async consumeResetToken(token: string): Promise<string | null> {
    const key = `reset:${this.hash(token)}`;
    const userId = await this.redis.get(key);
    if (userId) await this.redis.del(key);
    return userId;
  }

  // Email-change staging (verify-then-commit): the emailed link and a reverse
  // pointer per user. Both share CHANGE_TTL_S, so the pointer expires with the link;
  // MailService reacts to that expiry.
  async createEmailChangeToken(userId: string, newEmail: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const tokenHash = this.hash(token);
    const reverseKey = `emailchange:user:${userId}`;
    // Mint-or-rotate invalidates the previous link: its key is deleted (DEL
    // emits no `expired`, so that never fakes an expiry notice). The reverse
    // key is overwritten in place, so its TTL is simply refreshed.
    const previousHash = await this.redis.hget(reverseKey, 'tokenHash');
    const pipeline = this.redis.pipeline();
    if (previousHash) pipeline.del(`emailchange:${previousHash}`);
    pipeline.hset(`emailchange:${tokenHash}`, { userId, newEmail });
    pipeline.expire(`emailchange:${tokenHash}`, CHANGE_TTL_S);
    pipeline.hset(reverseKey, { tokenHash, newEmail });
    pipeline.expire(reverseKey, CHANGE_TTL_S);
    await pipeline.exec();
    return token;
  }

  // Returns the staged change and deletes both keys (single use), or null.
  async consumeEmailChangeToken(
    token: string,
  ): Promise<{ userId: string; newEmail: string } | null> {
    const tokenHash = this.hash(token);
    const key = `emailchange:${tokenHash}`;
    const data = await this.redis.hgetall(key);
    if (!data.userId || !data.newEmail) return null;

    const reverseKey = `emailchange:user:${data.userId}`;
    const pipeline = this.redis.pipeline();
    pipeline.del(key);
    // Drop the reverse pointer too, so a redeemed change can't later fire an
    // "expired" notice : unless a rotate already repointed it at a newer token.
    const currentHash = await this.redis.hget(reverseKey, 'tokenHash');
    if (currentHash === tokenHash) pipeline.del(reverseKey);
    await pipeline.exec();
    return { userId: data.userId, newEmail: data.newEmail };
  }

  // The address staged for a user (profile read + resend), or null.
  async peekEmailChange(userId: string): Promise<{ newEmail: string } | null> {
    const newEmail = await this.redis.hget(`emailchange:user:${userId}`, 'newEmail');
    return newEmail ? { newEmail } : null;
  }

  // Drop a staged change (mail-send rollback, commit-time conflict).
  async clearEmailChange(userId: string): Promise<void> {
    const reverseKey = `emailchange:user:${userId}`;
    const tokenHash = await this.redis.hget(reverseKey, 'tokenHash');
    const pipeline = this.redis.pipeline();
    if (tokenHash) pipeline.del(`emailchange:${tokenHash}`);
    pipeline.del(reverseKey);
    await pipeline.exec();
  }

  // Creates a 2FA login challenge: a pending token (stored in the client's
  // cookie) plus a 6-digit code emailed to the user. Called by auth.service.ts
  // login() for accounts with 2FA enabled.
  async startChallenge(userId: string): Promise<{ pendingToken: string; code: string }> {
    const pendingToken = randomBytes(32).toString('hex');
    const key = `2fa:${this.hash(pendingToken)}`;
    await this.redis.hset(key, { userId });
    const code = await this.issueCode(key);
    return { pendingToken, code };
  }

  // Returns the userId when the code matches (challenge consumed), else null.
  async verifyChallenge(pendingToken: string, code: string): Promise<string | null> {
    const key = `2fa:${this.hash(pendingToken)}`;
    const data = await this.redis.hgetall(key);
    if (!data.userId) return null; // unknown or expired

    if (parseInt((data as { attempts?: string }).attempts ?? '0', 10) >= MAX_ATTEMPTS) {
      await this.redis.del(key); // burn the challenge : brute-force cap
      return null;
    }
    if (this.hash(code) !== data.codeHash) {
      await this.redis.hincrby(key, 'attempts', 1);
      return null;
    }

    await this.redis.del(key); // single use
    return data.userId;
  }

  // Re-issue the code for a live challenge (same pendingToken; the previous code
  // is invalidated). Returns 'expired' for an unknown/lapsed challenge, 'locked'
  // when the per-user resend cap is hit, else a fresh { userId, code }.
  async resendChallenge(
    pendingToken: string,
  ): Promise<{ userId: string; code: string } | 'expired' | 'locked'> {
    const key = `2fa:${this.hash(pendingToken)}`;
    const data = await this.redis.hgetall(key);
    if (!data.userId) return 'expired';

    // Per-user cap on resends (keyed by userId so it outlives the challenge TTL).
    const rlKey = `2fa:rl:${data.userId}`;
    const count = await this.redis.incr(rlKey);
    if (count === 1) await this.redis.expire(rlKey, RESEND_WINDOW_S);
    if (count > MAX_RESENDS) return 'locked';

    const code = await this.issueCode(key);
    return { userId: data.userId, code };
  }
}
