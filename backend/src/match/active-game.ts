import type Redis from 'ioredis';
import { isEngineGameStarted } from './seat-finalization';

// The strict per-player game-state lock: at most one live game per player.
//
// A live game is one the match:* hash still tracks as in progress: either the
// hash says ACTIVE, or the engine has already started the game in that room (the
// hash can lag behind the engine). Statuses that mean the room is over
// (ABORTED, set by an abort or by the engine's expiry teardown, and the legacy
// ENDED value an older build wrote) never count, so a room that is done cannot
// keep its players locked out while its hash lingers for the rest of its TTL.
//
// Enforcement is backend-authoritative because the backend owns the match:*
// state: every create/join/rejoin path checks it through here. The frontend only
// mirrors it as a UI hint (greyed-out create/join buttons).
//
// The full rule is in docs/backend/backend-match-module.md.

// Hash statuses that mean the room is over: not a live game for anyone. ENDED is
// no longer written (the game-end callback deletes the hash); it stays listed so
// a hash left behind by an older build cannot lock its players out for the rest
// of its TTL.
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
