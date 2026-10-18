import type Redis from 'ioredis';
import { isEngineGameStarted } from './seat-finalization';

// The strict per-player game-state lock: at most one live game per player. A live
// game is ACTIVE or already started by the engine; ABORTED and legacy ENDED never
// count, so a done room cannot keep its players locked out. Full rule in the docs.

// Hash statuses that mean the room is over: not a live game for anyone. ENDED is no
// longer written; it stays listed so a hash left by an older build cannot lock its
// players out for the rest of its TTL.
const ENDED_MATCH_STATUSES = ['ABORTED', 'ENDED'];

// The four seat ids of a match hash, in slot order.
function seatIdsOf(data: Record<string, string>): string[] {
  return [data.player1_id, data.player2_id, data.player3_id, data.player4_id];
}

// Whether this user holds a seat in a live (in-progress) game right now. Pass
// `exceptGameId` to exempt one room: rejoining your own live room must still
// work, so that room never counts as "a second game".
export async function hasLiveMatch(
  redis: Redis,
  userId: string,
  exceptGameId?: string,
): Promise<boolean> {
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'match:*', 'COUNT', 100);
    cursor = nextCursor;
    for (const key of keys) {
      if (exceptGameId && key === `match:${exceptGameId}`) continue;
      const data = await redis.hgetall(key);
      if (!seatIdsOf(data).includes(userId)) continue;
      if (ENDED_MATCH_STATUSES.includes(data.status)) continue;
      if (data.status === 'ACTIVE') return true;
      // The hash can lag behind the engine, so the engine state decides too.
      if (await isEngineGameStarted(redis, data.id)) return true;
    }
  } while (cursor !== '0');
  return false;
}
