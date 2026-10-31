// Pure helpers for the `friendship:changed` record (socket D2). Like
// friendship-pair.ts this module imports no NestJS and no Prisma: the publisher
// builds the record, the broadcaster re-validates it, and neither needs a
// constructor dependency to share the same rules.

import { effectiveStatus, type FriendshipStatus, type PairLike } from './friendship-pair';

// The five states a recipient can hold about one pair. `state` is relative to the
// recipient, which is why one record can drive all three lists: the same row is
// `pending-out` for the sender and `pending-in` for the target, `blocked` only for
// the side that placed the block, and `none` deletes the row everywhere.
export type FriendshipViewState = 'accepted' | 'pending-in' | 'pending-out' | 'blocked' | 'none';

// The whole row a client keeps (D2), as seen from the recipient: `friend` is the
// other account, `friendsSince` is when the current state began (friends since /
// blocked since / requested at) and `requestId` is only set while a request is
// pending, because that is the id accept/decline take.
export interface FriendshipFriendView {
  id: string;
  username: string;
  displayName: string;
  avatarStyle: string;
  avatarV?: number;
  hasAvatarPhoto: boolean;
  rating: number;
  friendsSince: string | null;
  requestId?: string;
}

export interface FriendshipRecord {
  state: FriendshipViewState;
  friend: FriendshipFriendView;
}

// A stored pair row, with the fields the record needs. Timestamps are Dates
// because that is what Prisma hands back.
export interface FriendshipRowLike extends PairLike {
  id: string;
  createdAt: Date;
}

const STATES: readonly FriendshipViewState[] = [
  'accepted',
  'pending-in',
  'pending-out',
  'blocked',
  'none',
];

// One viewer's view of the pair. Order matters:
// 1. the viewer's own block is visible (*their* blocked list),
// 2. a block the other side holds is not: the pair simply disappears,
// 3. only mutual acceptance is a friendship,
// 4. a live request is outbound or inbound relative to this viewer,
// 5. everything else (none, or a decline inside its cooldown) has no row.
export function viewerState(
  pair: PairLike,
  viewerId: string,
  now: number = Date.now(),
): FriendshipViewState {
  const isUser1 = pair.user1Id === viewerId;
  const mine = effectiveStatus(
    isUser1 ? pair.user1Status : pair.user2Status,
    isUser1 ? pair.user1StatusAt : pair.user2StatusAt,
    now,
  );
  const theirs = effectiveStatus(
    isUser1 ? pair.user2Status : pair.user1Status,
    isUser1 ? pair.user2StatusAt : pair.user1StatusAt,
    now,
  );

  if (mine === 'blocked') return 'blocked';
  if (theirs === 'blocked') return 'none';
  if (mine === 'accepted' && theirs === 'accepted') return 'accepted';
  if (mine === 'pending') return 'pending-out';
  if (theirs === 'pending') return 'pending-in';
  return 'none';
}

// When the current state began. `friendsSince` carries whichever one applies, so
// the client renders "friends since", "blocked since" and a request's age from
// the same field instead of three per-state ones.
export function stateSince(
  pair: FriendshipRowLike,
  viewerId: string,
  state: FriendshipViewState,
): Date | null {
  if (state === 'none') return null;
  if (state === 'accepted') return pair.createdAt;

  const isUser1 = pair.user1Id === viewerId;
  const mineAt = isUser1 ? pair.user1StatusAt : pair.user2StatusAt;
  const theirsAt = isUser1 ? pair.user2StatusAt : pair.user1StatusAt;
  // A pending-in request is the *other* side's timestamp; a pending-out or a
  // block of one's own is this side's.
  const at = state === 'pending-in' ? theirsAt : mineAt;
  return at ?? pair.createdAt;
}

// The broadcaster's guard. A malformed message must not reach every client as a
// shape the reducer cannot read, so the state is checked against the enum and the
// row against its one required field.
const isViewState = (value: unknown): value is FriendshipViewState =>
  typeof value === 'string' && (STATES as readonly string[]).includes(value);

export function parseFriendshipRecord(raw: string): FriendshipRecord | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as { state?: unknown; friend?: { id?: unknown; username?: unknown } };
    if (!isViewState(candidate.state)) return null;
    const friend = candidate.friend;
    if (!friend || typeof friend.id !== 'string' || typeof friend.username !== 'string') {
      return null;
    }
    return { state: candidate.state, friend: friend as FriendshipFriendView };
  } catch {
    return null;
  }
}

// Re-exported for callers that map a stored directional status.
export type { FriendshipStatus };
