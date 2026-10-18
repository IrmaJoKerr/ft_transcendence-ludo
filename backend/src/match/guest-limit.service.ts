import { HttpException, HttpStatus, Injectable, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import { secret } from '../secrets';

// --- GUEST LIMITS: the whole knob block. Edit here, nowhere else. ---
// One guest room is a Redis hash, a socket and a bot loop, allocated anonymously.
// These counters bound that churn; @Throttle and nginx's `guest` zone take bursts.
const GUEST_LIMITS = {
  windowS: 6 * 60 * 60, //  how far back the per-address counters look
  mintSoftLimit: 10, //     mints past which each call costs the caller time
  mintHardLimit: 40, //     mints past which the address is refused
  abortWeight: 2, //        what one abort costs against the mint budget
  maxConcurrent: 3, //      live guest rooms per address
  maxLiveRooms: 50, //      live guest rooms, all addresses
  maxDelayS: 30, //         ceiling on the per-call delay, as in the login ladder
  liveTtlS: 60 * 60, //     self-heal TTL for the concurrency counter
  tokenTtlS: 60 * 60, //    lifetime of one guest token record
} as const;

// The registry TTL is read by MatchCreatorService when it writes the record.
export const GUEST_TOKEN_TTL_S = GUEST_LIMITS.tokenTtlS;

// 2^n stops growing here: 2^5 = 32 s is already past maxDelayS.
const MAX_DELAY_STEPS = 5;

// Counter keys. The engine keeps its own copy of guestKey(), these names and windowS
// (it prices an abort and gives the slot back); it decides no limit. Hashed as
// `login:fail:` is, so a Redis dump holds no addresses.
export function guestIpHash(ip: string): string {
  return createHash('sha256').update(ip).digest('hex');
}

export function guestKey(kind: 'mint' | 'abort' | 'live', ip: string): string {
  return `guest:${kind}:${guestIpHash(ip)}`;
}

// Not per address: one ceiling for the whole deployment, so a botnet rotating
// through addresses still cannot fill Redis or the engine's bot loops.
export const GUEST_ROOMS_LIVE = 'guest:rooms:live';

// Give a reserved slot back and never leave the key below zero: two releases
// (a create rollback racing the engine's own decrement) must not turn into a
// negative count that takes several mints to climb back to zero.
const DROP_SLOT = `
local left = redis.call('DECR', KEYS[1])
if left <= 0 then
  redis.call('DEL', KEYS[1])
  return 0
end
return left
`;

// Per-address guest budgets: counters here, thresholds above, plus the route's
// burst limit. An address is coarse (campus NAT, CGNAT), so the concurrency cap
// matters more than the mint cap.
@Injectable()
export class GuestLimitService implements OnModuleDestroy {
  private redis: Redis;

  constructor() {
    // Same idiom as LoginLockoutService / SessionService: host and port are
    // topology (plain env), the password is a secret.
    const host = process.env.REDIS_HOST ?? 'redis';
    const port = parseInt(process.env.REDIS_PORT ?? '6479', 10);
    const password = secret('REDIS_PASSWORD');

    this.redis = new Redis({ host, port, password, retryStrategy: (t) => Math.min(t * 50, 2000) });
    this.redis.on('error', (error) => {
      console.error('Guest limit Redis error:', error.message);
    });
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }

  private async count(key: string): Promise<number> {
    const raw = await this.redis.get(key);
    const count = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(count) && count > 0 ? count : 0;
  }

  // What this address has spent of its budget: one mint, or one abort at
  // abortWeight (an abort is the real churn vector: it burns a room, a socket
  // and bot timers and produces nothing).
  private async spent(ip: string): Promise<number> {
    const [mints, aborts] = await Promise.all([
      this.count(guestKey('mint', ip)),
      this.count(guestKey('abort', ip)),
    ]);
    return mints + aborts * GUEST_LIMITS.abortWeight;
  }

  // min(2^n, 30) s for the n-th mint past the soft limit, the login ladder
  // verbatim: 2 s, 4 s, 8 s, 16 s, then the 30 s ceiling.
  private delayMs(spent: number): number {
    const step = Math.min(spent - GUEST_LIMITS.mintSoftLimit + 1, MAX_DELAY_STEPS);
    return Math.min(2 ** step * 1000, GUEST_LIMITS.maxDelayS * 1000);
  }

  // Gate + reserve, in that order: a refused caller never delays and never
  // touches a counter; an allowed one holds a slot before the room exists, so
  // concurrent requests cannot both pass the same check.
  async acquire(ip: string): Promise<void> {
    const spent = await this.spent(ip);
    if (spent >= GUEST_LIMITS.mintHardLimit) throw this.limited();
    if (spent >= GUEST_LIMITS.mintSoftLimit) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs(spent)));
    }

    const live = await this.reserve(guestKey('live', ip));
    if (live > GUEST_LIMITS.maxConcurrent) {
      await this.drop(guestKey('live', ip));
      throw this.limited();
    }

    const rooms = await this.reserve(GUEST_ROOMS_LIVE);
    if (rooms > GUEST_LIMITS.maxLiveRooms) {
      await this.drop(GUEST_ROOMS_LIVE);
      await this.drop(guestKey('live', ip));
      throw this.capacity();
    }
  }

  // The room was never created (a bad colour, a Redis failure): give both
  // slots back so a failed mint costs the caller nothing.
  async release(ip: string): Promise<void> {
    await this.drop(guestKey('live', ip));
    await this.drop(GUEST_ROOMS_LIVE);
  }

  // One successful mint against the address. The window starts at the first
  // mint and is not restarted by later ones, so an address that keeps playing
  // regains a full budget after the window rather than never.
  async recordMint(ip: string): Promise<void> {
    const key = guestKey('mint', ip);
    const mints = await this.redis.incr(key);
    if (mints === 1) await this.redis.expire(key, GUEST_LIMITS.windowS);
  }

  private async reserve(key: string): Promise<number> {
    const count = await this.redis.incr(key);
    // Self-heal: a crashed process must not wedge an address (or the global
    // ceiling) forever, which is the one counter that cannot be farmed.
    if (count === 1) await this.redis.expire(key, GUEST_LIMITS.liveTtlS);
    return count;
  }

  private async drop(key: string): Promise<void> {
    await this.redis.eval(DROP_SLOT, 1, key);
  }

  // Two distinct refusals, because they are two distinct products: "you have
  // used your guest games" is answered with a sign-in nudge, "guests are full"
  // with try-again-later.
  private limited(): HttpException {
    return new HttpException(
      {
        code: 'GUEST_LIMITED',
        message: 'Guest game limit reached: sign in to keep playing',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private capacity(): HttpException {
    return new HttpException(
      { code: 'GUEST_CAPACITY', message: 'Guest games are full: try again shortly' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
