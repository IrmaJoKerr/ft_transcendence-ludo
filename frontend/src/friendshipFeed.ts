import type { FriendshipRecord } from './sessionSocket';
import type { PresenceStatus } from './theme';

// The three friendship lists, derived from two sources: the first-paint snapshot
// (`GET /api/friends`, `/requests`, `/blocked`) and the live `friendship:changed`
// records. A record always wins over the snapshot — it is the later truth — and a
// record for a row the snapshot never had still appears. That is what makes the
// feed self-healing instead of a patch stream (socket D2).

export type FriendRow = {
  id: string;
  username: string;
  displayName?: string;
  avatarStyle: string | null;
  avatarV?: number;
  hasAvatarPhoto?: boolean;
  rating: number;
  /** When the friendship began; null on a row that arrived from a block/request. */
  friendsSince: string | null;
  status: PresenceStatus;
};

export type FriendRequestRow = {
  /** The pair row id: what accept/decline take. */
  id: string;
  userId: string;
  username: string;
  displayName?: string;
  avatarStyle: string | null;
  avatarV?: number;
  hasAvatarPhoto?: boolean;
  createdAt: string;
};

export type BlockedRow = {
  id: string;
  username: string;
  displayName?: string;
  avatarStyle: string | null;
  avatarV?: number;
  hasAvatarPhoto?: boolean;
  rating: number;
  blockedSince: string;
};

export type FriendshipSnapshot = {
  friends: FriendRow[];
  requests: { sent: FriendRequestRow[]; received: FriendRequestRow[] };
  blocked: BlockedRow[];
};

// Live records, keyed by the *other* account's id: one per changed pair, so the
// newest record for a row replaces the previous one outright.
export type FriendshipRecordMap = Record<string, FriendshipRecord>;

export const EMPTY_SNAPSHOT: FriendshipSnapshot = {
  friends: [],
  requests: { sent: [], received: [] },
  blocked: [],
};

// Friends = snapshot ∪ accepted records − everything else. Presence overrides the
// snapshot's status last: `friend_online`/`friend_offline` are the only live source
// for the dots now that the list is not polled.
export function mergeFriends(
  snapshot: FriendRow[],
  records: FriendshipRecordMap,
  presence: Record<string, PresenceStatus> = {},
): FriendRow[] {
  const rows = new Map<string, FriendRow>();
  for (const row of snapshot) rows.set(row.id, row);

  for (const record of Object.values(records)) {
    const friend = record.friend;
    if (record.state !== 'accepted') {
      rows.delete(friend.id);
      continue;
    }
    const previous = rows.get(friend.id);
    rows.set(friend.id, {
      id: friend.id,
      username: friend.username,
      displayName: friend.displayName,
      avatarStyle: friend.avatarStyle,
      avatarV: friend.avatarV,
      hasAvatarPhoto: friend.hasAvatarPhoto,
      rating: friend.rating,
      // A content push carries the pair's age; keep the known one if it does not.
      friendsSince: friend.friendsSince ?? previous?.friendsSince ?? null,
      status: previous?.status ?? 'offline',
    });
  }

  return [...rows.values()].map((row) => ({
    ...row,
    status: presence[row.id] ?? row.status,
  }));
}

// Requests = the snapshot's two lists, re-derived from the records: `pending-in`
// is a request received, `pending-out` one sent, and any other state removes the
// row from both (accepted, declined, blocked or gone).
export function mergeRequests(
  snapshot: { sent: FriendRequestRow[]; received: FriendRequestRow[] },
  records: FriendshipRecordMap,
): { sent: FriendRequestRow[]; received: FriendRequestRow[] } {
  const sent = new Map(snapshot.sent.map((row) => [row.userId, row]));
  const received = new Map(snapshot.received.map((row) => [row.userId, row]));

  for (const record of Object.values(records)) {
    const friend = record.friend;
    if (record.state !== 'pending-in' && record.state !== 'pending-out') {
      sent.delete(friend.id);
      received.delete(friend.id);
      continue;
    }
    const row: FriendRequestRow = {
      id: record.friend.requestId ?? '',
      userId: friend.id,
      username: friend.username,
      displayName: friend.displayName,
      avatarStyle: friend.avatarStyle,
      avatarV: friend.avatarV,
      hasAvatarPhoto: friend.hasAvatarPhoto,
      // For a pending row `friendsSince` is when the request was made.
      createdAt: friend.friendsSince ?? '',
    };
    if (record.state === 'pending-in') {
      received.set(friend.id, row);
      sent.delete(friend.id);
    } else {
      sent.set(friend.id, row);
      received.delete(friend.id);
    }
  }

  return { sent: [...sent.values()], received: [...received.values()] };
}

// Blocked = the snapshot's blocks, kept only while the record still says
// `blocked`. A block the *other* side placed arrives as `none`, so it never
// appears here.
export function mergeBlocked(snapshot: BlockedRow[], records: FriendshipRecordMap): BlockedRow[] {
  const rows = new Map(snapshot.map((row) => [row.id, row]));

  for (const record of Object.values(records)) {
    const friend = record.friend;
    if (record.state !== 'blocked') {
      rows.delete(friend.id);
      continue;
    }
    rows.set(friend.id, {
      id: friend.id,
      username: friend.username,
      displayName: friend.displayName,
      avatarStyle: friend.avatarStyle,
      avatarV: friend.avatarV,
      hasAvatarPhoto: friend.hasAvatarPhoto,
      rating: friend.rating,
      // For a block `friendsSince` is when it was placed.
      blockedSince: friend.friendsSince ?? rows.get(friend.id)?.blockedSince ?? '',
    });
  }

  return [...rows.values()];
}
