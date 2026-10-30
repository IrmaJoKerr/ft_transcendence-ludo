// Presence is read off the session socket now, not off a client heartbeat: the
// gateway refreshes this row for every live connection, so a live socket never
// lets the row lapse and a silently dead one stops refreshing without anyone
// noticing. The TTL stays a pure backstop (socket consolidation, Phase 1).
export const PRESENCE_TTL_S = 45;

// Server-side refresh of a connection's row. Comfortably inside the TTL, so one
// late tick (a stalled event loop, a paused container) cannot expire a live tab.
export const PRESENCE_REFRESH_MS = 20_000;

// The set of live session-socket ids per account. `presence:<userId>` answers
// "is this account online"; this set answers "how many tabs", which is what keeps
// closing one of N tabs from flipping the account offline. Every SADD is paired
// with an EXPIRE at the row's TTL, so a backend restart cannot strand members
// that the close path would then wait on forever. The prefix is filtered out of
// the online-count SCAN: it shares the `presence:` namespace but is not an account.
export const PRESENCE_CONNS_PREFIX = 'presence:conns:';
export const presenceConnsKey = (userId: string): string => `${PRESENCE_CONNS_PREFIX}${userId}`;

// The Redis channel the broadcaster turns into the client's `counts:online`.
// getOnlineCount() is a SCAN, so two connection edges in the same instant must
// coalesce into one push.
export const PRESENCE_COUNT_CHANNEL = 'presence:count';
export const PRESENCE_COUNT_COALESCE_MS = 5_000;
