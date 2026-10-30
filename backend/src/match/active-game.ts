import type Redis from 'ioredis';
import { isEngineGameStarted } from './seat-finalization';

// The strict per-player game-state lock: at most one live game per player. A live
// game is ACTIVE or already started by the engine; ABORTED and legacy ENDED never
// count, so a done room cannot keep its players locked out. Full rule in the docs.

// Hash statuses that mean the room is over: not a live game for anyone. ENDED is no
// longer written; it stays listed so a hash left by an older build cannot lock its
// players out for the rest of its TTL. Exported because rejoin refuses the same two
// statuses: a closed room is not a room to hand a token back into.
export const ENDED_MATCH_STATUSES = ['ABORTED', 'ENDED'];

// The four seat ids of a match hash, in slot order. Shared with the account
// deletion sweep, which aborts every room a deleted user sits in (not just the
// one live room the strict lock allows).
export function matchSeatIds(data: Record<string, string>): string[] {
  return [data.player1_id, data.player2_id, data.player3_id, data.player4_id];
}

// The user's live game. Sign-out publishes on this room id, and a caller that
// only needs the boolean reads the return as a truth test.
export interface LiveMatch {
  gameId: string;
}

// The live (in-progress) game this user holds a seat in right now, or null. Pass
// `exceptGameId` to exempt one room: rejoining your own live room must still
// work, so that room never counts as "a second game".
export async function findLiveMatch(
  redis: Redis,
  userId: string,
  exceptGameId?: string,
): Promise<LiveMatch | null> {
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'match:*', 'COUNT', 100);
    cursor = nextCursor;
    for (const key of keys) {
      if (exceptGameId && key === `match:${exceptGameId}`) continue;
      const data = await redis.hgetall(key);
      if (!matchSeatIds(data).includes(userId)) continue;
      if (ENDED_MATCH_STATUSES.includes(data.status)) continue;
      // The hash's own id is authoritative; the key suffix covers a hash written
      // without one.
      const gameId = data.id ?? key.slice('match:'.length);
      if (data.status === 'ACTIVE') return { gameId };
      // The hash can lag behind the engine, so the engine state decides too.
      if (await isEngineGameStarted(redis, gameId)) return { gameId };
    }
  } while (cursor !== '0');
  return null;
}
