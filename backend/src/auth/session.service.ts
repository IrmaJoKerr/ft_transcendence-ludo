import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { createHash, randomBytes } from 'node:crypto';
import { REDIS_CLIENT } from '../common/redis-client';
import { AUTH_REVOKED_PREFIX } from './auth.constants';

const REFRESH_TTL_S = 7 * 24 * 60 * 60; // refresh tokens live 7 days
// A consumed token replayed this soon, while its replacement is live, is the known
// two-tab race, not theft. Older replays revoke every session.
const REUSE_GRACE_MS = 15_000;

export type RotateResult = { userId: string; newToken: string } | { reused: true } | null;

// One live session per account, atomically: drop every sibling refresh key, then write
// the new one. A Lua script prevents an overlapping login and rotation from leaving two
// sessions or none. Returns the sibling count evicted; zero is an ordinary refresh.
const ISSUE_SESSION = `
local key = KEYS[1]
local newHash = ARGV[1]
local userId = ARGV[2]
local ttl = tonumber(ARGV[3])
local evicted = 0
for _, h in ipairs(redis.call('SMEMBERS', key)) do
  if h ~= newHash then
    redis.call('DEL', 'refresh:' .. h)
    evicted = evicted + 1
  end
end
redis.call('DEL', key)
redis.call('SET', 'refresh:' .. newHash, userId, 'EX', ttl)
redis.call('SADD', key, newHash)
redis.call('EXPIRE', key, ttl)
return evicted
`;

@Injectable()
// Refresh-token session store in Redis: minting, rotation and revocation of
// the 7-day refresh tokens that back the 15-min JWT access tokens. Used by the
// auth services (login, refresh, logout, password reset, account deletion).
export class SessionService {
  // Redis holds `refresh:<sha256(token)>` to userId plus a `sessions:<userId>` index.
  // The index has at most one hash and is the list the revoke methods walk; deleting a
  // refresh key alone would leave a hash for the next sweep.
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  // Mint a new refresh token for a user and record it as a live session. One
  // session per account (D8): the newest login takes the account over, so the
  // others are revoked in the same atomic step that writes this one.
  async issue(userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const evicted = await this.redis.eval(
      ISSUE_SESSION,
      1,
      `sessions:${userId}`,
      this.hash(token),
      userId,
      REFRESH_TTL_S,
    );
    // The push closes the superseded device's sockets (D4), so a login from
    // another machine ends the first one at once. A rotation evicts nothing
    // (its consumed hash was already removed), so an ordinary refresh is silent.
    if (Number(evicted) > 0) await this.publishRevoked(userId);
    return token;
  }

  // Verify and rotate a refresh token: consume the old one and issue a fresh one.
  // Returns userId + token, null for unknown or expired, or { reused: true } for a
  // token returned after the race window (theft); that user's sessions are revoked.
  async rotate(oldToken: string): Promise<RotateResult> {
    const oldHash = this.hash(oldToken);
    // GETDEL consumes the token atomically, so two simultaneous callers cannot
    // both redeem it and each mint a session.
    const userId = await this.redis.getdel(`refresh:${oldHash}`);
    if (!userId) return this.handleUnknownToken(oldHash);

    await this.redis.srem(`sessions:${userId}`, oldHash);

    const newToken = await this.issue(userId);
    // Remember the consumed token for a full refresh lifetime: it is what tells
    // a benign duplicate apart from a replay.
    await this.redis.set(
      `refresh-used:${oldHash}`,
      JSON.stringify({ userId, newHash: this.hash(newToken), at: Date.now() }),
      'EX',
      REFRESH_TTL_S,
    );
    return { userId, newToken };
  }

  // A dead token may be a recent rotation whose replacement is live: the cross-tab
  // race, which returns null so the client probes /me. Anything else is reuse, so
  // fail closed and sign the account out everywhere.
  private async handleUnknownToken(oldHash: string): Promise<RotateResult> {
    const raw = await this.redis.get(`refresh-used:${oldHash}`);
    if (!raw) return null;
    let record: { userId?: string; newHash?: string; at?: number };
    try {
      record = JSON.parse(raw) as typeof record;
    } catch {
      return null;
    }
    if (!record.userId || !record.newHash || typeof record.at !== 'number') return null;

    const replacementLive = await this.redis.exists(`refresh:${record.newHash}`);
    if (replacementLive && Date.now() - record.at <= REUSE_GRACE_MS) return null;

    await this.revokeAll(record.userId);
    console.warn(
      `[session] refresh token reuse detected for user ${record.userId}: all sessions revoked`,
    );
    return { reused: true };
  }

  // Revoke a single session (logout on this device). Returns the account the
  // token belonged to: logout needs it to end that account's live match, and this
  // lookup already reads it. An unknown or expired token returns null.
  async revoke(token: string): Promise<string | null> {
    const h = this.hash(token);
    const userId = await this.redis.get(`refresh:${h}`);
    await this.redis.del(`refresh:${h}`);
    if (userId) {
      await this.redis.srem(`sessions:${userId}`, h);
      await this.publishRevoked(userId);
    }
    return userId;
  }

  // Revoke every session a user has (e.g. after a password reset).
  async revokeAll(userId: string): Promise<void> {
    const hashes = await this.redis.smembers(`sessions:${userId}`);
    const keys = hashes.map((h) => `refresh:${h}`);
    if (keys.length) await this.redis.del(...keys);
    await this.redis.del(`sessions:${userId}`);
    await this.publishRevoked(userId);
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
    // The push is per account (D4 carries no session id), so the kept device
    // loses its socket too and reconnects at once with its still-valid cookie.
    if (revokeHashes.length > 0) await this.publishRevoked(userId);
  }

  // The socket layer closes a revoked account's sockets by push, so an access
  // token that outlives its session cannot keep a connection receiving events.
  private async publishRevoked(userId: string): Promise<void> {
    await this.redis.publish(`${AUTH_REVOKED_PREFIX}${userId}`, '1');
  }
}

// Session flow: the client gets a JWT (15 min) plus a refresh token (7 days) as
// httpOnly cookies. On a 401, apiFetch POSTs /api/auth/refresh with the refresh
// cookie, the server rotates both tokens, and apiFetch retries.
