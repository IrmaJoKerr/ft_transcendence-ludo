// Pure helpers for the "superset" Friendship pair row. This module imports
// nothing (no NestJS, no Prisma), so friends, match, and presence can share the
// same predicates without creating circular constructor dependencies.

// Directional status of one side of a pair. A row holds two of these
// (user1Status = user1's action toward user2).
export type FriendshipStatus = 'none' | 'pending' | 'accepted' | 'declined' | 'blocked';

// A live outbound request expires after 24h; a declined direction stops
// blocking re-requests after this 1h cooldown.
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
export const DECLINE_COOLDOWN_MS = 60 * 60 * 1000;

// How long a challenge (the invite one friend sends another to a room) counts as
// pending. It matches the staged invite record's own life in
// MatchPlayerService.assertInvitableRoom: a waiting room that nobody joins is
// gone in five minutes, so a challenge cannot outlive the thing it points at.
// The window is what makes a second press a report instead of a second room.
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

// The fields the predicates below need from a Friendship row.
export interface PairLike {
  user1Id: string;
  user2Id: string;
  user1Status: FriendshipStatus;
  user2Status: FriendshipStatus;
  user1StatusAt: Date | null;
  user2StatusAt: Date | null;
}

// Unordered pair identity: sorting the two ids guarantees exactly one row per
// user pair, whatever direction a request was made from.
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

// Lazy expiry applied to a stored directional status: an old pending, or a
// declined past its cooldown, reads as none for gating purposes.
export function effectiveStatus(
  status: FriendshipStatus,
  statusAt: Date | null,
  now: number = Date.now(),
): FriendshipStatus {
  const at = statusAt ? statusAt.getTime() : 0;
  if (status === 'pending' && now - at > PENDING_TTL_MS) return 'none';
  if (status === 'declined' && now - at > DECLINE_COOLDOWN_MS) return 'none';
  return status;
}

// True when either side has blocked the other. A block hides the pair
// everywhere, regardless of the other direction's status.
export function isBlockedPair(pair: PairLike): boolean {
  return pair.user1Status === 'blocked' || pair.user2Status === 'blocked';
}

// Friends only when both directions consent and neither side is blocked.
export function isFriendPair(pair: PairLike, now: number = Date.now()): boolean {
  if (isBlockedPair(pair)) return false;
  return (
    effectiveStatus(pair.user1Status, pair.user1StatusAt, now) === 'accepted' &&
    effectiveStatus(pair.user2Status, pair.user2StatusAt, now) === 'accepted'
  );
}
