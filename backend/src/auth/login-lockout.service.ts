import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../common/redis-client';
import { AUTH } from './auth.constants';

const FAIL_WINDOW_S = AUTH.loginLockout.windowS;
const SOFT_LIMIT = AUTH.loginLockout.softLimit;
const HARD_LIMIT = AUTH.loginLockout.hardLimit;
const HARD_LOCK_S = AUTH.loginLockout.hardLockS;
const MAX_DELAY_MS = AUTH.loginLockout.maxDelayS * 1000;
// 2^n stops growing here: 2^5 = 32 s is already past MAX_DELAY_MS.
const MAX_DELAY_STEPS = 5;

// Per-account login lockout (security-review F-08). The route's @Throttle and
// nginx's limit_req are keyed by client address, so these counters are keyed by
// the account. Ladder, thresholds and error shape: backend-auth-module.md.
@Injectable()
export class LoginLockoutService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  // Hashed like twofactor/session tokens, so a Redis dump holds no usernames.
  // Case-folded, so "Bob" and "bob" cannot each spend a fresh budget.
  private key(identifier: string): string {
    const normalized = identifier.trim().toLowerCase();
    return `login:fail:${createHash('sha256').update(normalized).digest('hex')}`;
  }

  private async failures(identifier: string): Promise<number> {
    const raw = await this.redis.get(this.key(identifier));
    const count = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(count) && count > 0 ? count : 0;
  }

  // min(2^n, 30) s for the n-th failure past the soft limit: 2 s, 4 s, 8 s,
  // 16 s, then the 30 s ceiling.
  private delayMs(failures: number): number {
    const step = Math.min(failures - SOFT_LIMIT + 1, MAX_DELAY_STEPS);
    return Math.min(2 ** step * 1000, MAX_DELAY_MS);
  }

  // Called before the password is checked, so a locked account costs no bcrypt
  // compare and an unknown identifier behaves exactly like a known one.
  async gate(identifier: string): Promise<void> {
    const failures = await this.failures(identifier);
    if (failures >= HARD_LIMIT) throw this.invalidCredentials();
    if (failures >= SOFT_LIMIT) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs(failures)));
    }
  }

  // One failure recorded against the identifier. Called for an unknown
  // identifier too, so a wrong username is indistinguishable from a wrong
  // password and both cost the same budget.
  async recordFailure(identifier: string): Promise<void> {
    const key = this.key(identifier);
    const failures = await this.redis.incr(key);
    // Each failure restarts the window, and a count past the hard limit takes the
    // lockout TTL instead (the two are equal today: separate knobs on purpose).
    await this.redis.expire(key, failures >= HARD_LIMIT ? HARD_LOCK_S : FAIL_WINDOW_S);
  }

  async recordSuccess(identifier: string): Promise<void> {
    await this.redis.del(this.key(identifier));
  }

  private invalidCredentials(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'AUTH_INVALID_CREDENTIALS',
      message: 'Invalid username, email, or password',
    });
  }
}
