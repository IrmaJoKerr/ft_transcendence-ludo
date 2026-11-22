// Presence is refreshed by the session socket, not a client heartbeat. The TTL is a
// backstop: a live socket keeps the row, and a dead one simply stops refreshing it.
export const PRESENCE_TTL_S = 45;

// Server-side refresh of a connection's row. Comfortably inside the TTL, so one
// late tick (a stalled event loop, a paused container) cannot expire a live tab.
export const PRESENCE_REFRESH_MS = 20_000;

// Live session-socket ids per account, so closing one of N tabs does not go offline.
// Every SADD is paired with an EXPIRE. The prefix is filtered out of the online-count
// SCAN because it shares the `presence:` namespace but is not an account.
export const PRESENCE_CONNS_PREFIX = 'presence:conns:';
export const presenceConnsKey = (userId: string): string => `${PRESENCE_CONNS_PREFIX}${userId}`;

// The Redis channel the broadcaster turns into the client's `counts:online`.
// getOnlineCount() is a SCAN, so two connection edges in the same instant must
// coalesce into one push.
export const PRESENCE_COUNT_CHANNEL = 'presence:count';
export const PRESENCE_COUNT_COALESCE_MS = 5_000;
