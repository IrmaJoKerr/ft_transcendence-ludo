import { useCallback, useEffect, useMemo, useState } from 'react';
import { getApi } from '../api';
import { applyAvatarChange } from '../avatarCache';
import {
  EMPTY_SNAPSHOT,
  mergeBlocked,
  mergeFriends,
  mergeRequests,
  type BlockedRow,
  type FriendRequestRow,
  type FriendRow,
  type FriendshipRecordMap,
  type FriendshipSnapshot,
} from '../friendshipFeed';
import type { FriendshipRecord } from '../sessionSocket';
import { useApp } from '../store';
import { useNotifications } from './useNotifications';

// The live half of the friend lists (socket D2). One record per changed pair,
// viewer-relative: the newest record for an account replaces the previous one and
// the screen's first-paint snapshot merges *under* it, so a lost frame is repaired
// by the next fetch instead of leaving a wrong row forever.
//
// Registered at mount, which happens as soon as a signed-in screen renders; the
// snapshot arrives later and merges beneath whatever landed in between.
export function useFriendshipRecords(): FriendshipRecordMap {
  const { sessionSocket } = useApp();
  const [records, setRecords] = useState<FriendshipRecordMap>({});

  useEffect(() => {
    // A guest never opens a socket, and a signed-out hook must not keep the last
    // account's rows: `records` is only read while a socket exists.
    if (!sessionSocket) return;

    const onChanged = (record: FriendshipRecord) => {
      // The record's stamp is the photo's `?v=`: applying it here is what makes the
      // avatar update without a second request (and without minting a stamp for an
      // unchanged one — the server only sends what its cache holds).
      if (typeof record.friend.avatarV === 'number') {
        applyAvatarChange(record.friend.id, {
          has: record.friend.hasAvatarPhoto,
          style: record.friend.avatarStyle,
          v: record.friend.avatarV,
        });
      }
      setRecords((prev) => ({ ...prev, [record.friend.id]: record }));
    };

    // A reconnect is a new stream with no replay, so the old socket's records are
    // dropped and the repair fetch (below) rebuilds the snapshot.
    const onConnect = () => setRecords({});

    sessionSocket.on('friendship:changed', onChanged);
    sessionSocket.on('connect', onConnect);
    return () => {
      sessionSocket.off('friendship:changed', onChanged);
      sessionSocket.off('connect', onConnect);
    };
  }, [sessionSocket]);

  return records;
}

export type FriendshipFeed = {
  friends: FriendRow[];
  requests: { sent: FriendRequestRow[]; received: FriendRequestRow[] };
  blocked: BlockedRow[];
  /** True until the first snapshot has landed (or failed). */
  loading: boolean;
  /** Re-read the snapshot — after a mutation, on reconnect, on window focus. */
  refresh: () => void;
};

// A screen's whole friendship state: one initial read for first paint, then the
// socket. Nothing here polls: `friendship:changed` drives the lists, and the two
// repair triggers (reconnect, window focus) cover everything a frame cannot.
export function useFriendships(): FriendshipFeed {
  const { sessionSocket } = useApp();
  const records = useFriendshipRecords();
  const { friendPresence: presence } = useNotifications();
  const [snapshot, setSnapshot] = useState<FriendshipSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  const refresh = useCallback(() => setRevision((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getApi<FriendRow[]>('/api/friends'),
      getApi<{ sent: FriendRequestRow[]; received: FriendRequestRow[] }>('/api/friends/requests'),
      getApi<BlockedRow[]>('/api/friends/blocked'),
    ])
      .then(([friends, requests, blocked]) => {
        if (cancelled) return;
        setSnapshot({
          friends: Array.isArray(friends) ? friends : [],
          requests: {
            sent: Array.isArray(requests.sent) ? requests.sent : [],
            received: Array.isArray(requests.received) ? requests.received : [],
          },
          blocked: Array.isArray(blocked) ? blocked : [],
        });
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [revision]);

  // The repair paths (D2). The first `connect` is the mount's own fetch, so it only
  // marks the connection as seen; a later one means a reconnect whose frames are
  // gone. Window focus covers a tab that was hidden through a change — and the one
  // thing the socket cannot report, a pending request lapsing at its 24h TTL.
  useEffect(() => {
    if (!sessionSocket) return;
    let seen = sessionSocket.connected;
    const onConnect = () => {
      if (seen) refresh();
      else seen = true;
    };
    const onFocus = () => refresh();

    sessionSocket.on('connect', onConnect);
    window.addEventListener('focus', onFocus);
    return () => {
      sessionSocket.off('connect', onConnect);
      window.removeEventListener('focus', onFocus);
    };
  }, [sessionSocket, refresh]);

  const friends = useMemo(
    () => mergeFriends(snapshot.friends, records, presence),
    [snapshot.friends, records, presence],
  );
  const requests = useMemo(
    () => mergeRequests(snapshot.requests, records),
    [snapshot.requests, records],
  );
  const blocked = useMemo(
    () => mergeBlocked(snapshot.blocked, records),
    [snapshot.blocked, records],
  );

  return { friends, requests, blocked, loading, refresh };
}
