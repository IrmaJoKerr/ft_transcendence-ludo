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

// The refusal ladder of a challenge (19.6), in order: the first refusal costs the
// pair two hours, the second four, the third and every later one a day. The streak
// that indexes it lives on the Friendship row and is reset by an accepted
// challenge, so the ladder prices a history of refusals rather than a rate over a
// window; a challenge that simply expires writes nothing and costs nothing.
export const REFUSAL_LADDER_MS = [2 * 60 * 60 * 1000, 4 * 60 * 60 * 1000, 24 * 60 * 60 * 1000];

// How long a refusal buys, given the streak *after* it (1 is the first refusal).
// Past the end of the ladder every further refusal stays at the last rung.
export function refusalCooldownMs(streak: number): number {
  const index = Math.min(Math.max(streak, 1), REFUSAL_LADDER_MS.length) - 1;
  return REFUSAL_LADDER_MS[index];
}

// The fields the predicates below need from a Friendship row.
export interface PairLike {
  user1Id: string;
  user2Id: string;
  user1Status: FriendshipStatus;
  user2Status: FriendshipStatus;
  user1StatusAt: Date | null;
  user2StatusAt: Date | null;
}

// A pair row plus its ladder. Kept apart from PairLike because the predicates above
// never read the ladder: only the send and the two answers to a challenge do.
export interface RefusalPairLike extends PairLike {
  user1RefusalStreak: number;
  user2RefusalStreak: number;
  user1RefusalsUntil: Date | null;
  user2RefusalsUntil: Date | null;
}

// One side's ladder, as the player who owns that side holds it. `isUser1` is the
// column pair the refusal writes, so a refusal can never land on the other rung.
export type RefusalSide = {
  streak: number;
  until: Date | null;
  isUser1: boolean;
};

// Whose ladder a user owns, and what is on it. The two sides are separate columns
// precisely so one player's rung cannot move the other's.
export function refusalSide(pair: RefusalPairLike, refuserId: string): RefusalSide {
  const isUser1 = pair.user1Id === refuserId;
  return isUser1
    ? { streak: pair.user1RefusalStreak, until: pair.user1RefusalsUntil, isUser1 }
    : { streak: pair.user2RefusalStreak, until: pair.user2RefusalsUntil, isUser1 };
}

// The rung the next refusal lands on: the streak *after* it, and the deadline that
// buys. A refusal while a deadline is already running still moves the streak, so the
// window after it is longer — the ladder prices the count, not the interval.
export function nextRefusal(
  side: RefusalSide,
  now: number = Date.now(),
): { streak: number; until: Date } {
  const streak = side.streak + 1;
  return { streak, until: new Date(now + refusalCooldownMs(streak)) };
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
