import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { useApp } from '../store';
import { apiFetch, postApi } from '../api';
import { applyAvatarChange } from '../avatarCache';
import type { Notification } from '../sessionSocket';
import type { PresenceStatus } from '../theme';

// **Types**

// The wire shape is owned by the transport (sessionSocket.ts); the bell and the
// toasts read it through this module, so every consumer keeps its old import.
export type { Notification, NotificationType } from '../sessionSocket';
export type InAppNotification = Notification;

// The boot report (22.2): one row list and one total, computed from the unread
// snapshot the handshake delivers and then frozen. Live frames that arrive after
// it get their own card instead of editing the report under the reader's eyes.
export interface DigestReport {
  rows: Notification[];
  total: number;
}

// Why a card went (22.3). `read` means the entry it spoke for is dealt with and
// the store deletes it; `timeout` means nobody was looking and only the card
// hides, leaving the entry unread in the bell.
export type ToastDismissReason = 'timeout' | 'read';

// The cross-tab fact: which entries this tab deleted. A `storage` write rather
// than a BroadcastChannel frame, because it is a fact about the store that has
// to survive another tab reloading mid-delete (22.3 item 4).
const NOTIF_READ_KEY = 'lr.notifRead';

// One write per deletion, carrying the ids. Storage can be blocked (private
// modes), and a tab that misses the event catches up on its next snapshot.
function announceRead(ids: string[]): void {
  if (ids.length === 0) return;
  try {
    localStorage.setItem(NOTIF_READ_KEY, JSON.stringify({ ids, at: Date.now() }));
  } catch {
    // Ignore: the entries are deleted server-side either way.
  }
}

interface NotificationsContextValue {
  notifications: Notification[];
  toasts: Notification[];
  unreadCount: number;
  markRead: (id: string) => void;
  markReadMany: (ids: string[]) => void;
  markAllRead: () => void;
  dismissToast: (id: string, reason?: ToastDismissReason) => void;
  /** The last presence edge each friend's account announced on this connection.
   * The friends lists read it for their dots now that they are not polled. */
  friendPresence: Record<string, PresenceStatus>;
  /** The bell panel's open state: the navbar's trigger and the digest toast both
   * drive it, so it cannot live in the navbar's local state. */
  bellOpen: boolean;
  setBellOpen: (open: boolean) => void;
  openBell: () => void;
  /** The boot report: the rows the handshake snapshot held, frozen for this load.
   * `null` once its `x` wiped it, or when there was nothing to report. */
  digest: DigestReport | null;
  dismissDigest: () => void;
  /** True while the socket is down: the bell says so instead of reading empty,
   * because the socket is its only source (there is no REST list route). */
  unavailable: boolean;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

// Merge by id, newest first: a snapshot and a live frame can arrive in either
// order, and the same id may come twice (a frame just before the snapshot).
function mergeById(current: Notification[], incoming: Notification[]): Notification[] {
  const byId = new Map(current.map((n) => [n.id, n]));
  for (const n of incoming) {
    if (n?.id) byId.set(n.id, n);
  }
  return [...byId.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

// **Provider**

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user, sessionSocket } = useApp();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [toasts, setToasts] = useState<Notification[]>([]);
  // userId -> the last presence edge seen on this stream. A transient toast is
  // dismissed; this map is not: it is what keeps a friend's dot honest between
  // the list's first paint and the next repair fetch.
  const [friendPresence, setFriendPresence] = useState<Record<string, PresenceStatus>>({});
  const [bellOpen, setBellOpen] = useState(false);
  // The boot report and the guard that freezes it: armed by the first snapshot,
  // never re-armed, so a reconnect cannot re-pop the card while a reload always
  // does (22.2 item 4).
  const [digest, setDigest] = useState<DigestReport | null>(null);
  const digestArmed = useRef(false);
  const [unavailable, setUnavailable] = useState(false);

  const userId = user?.id;

  const openBell = useCallback(() => setBellOpen(true), []);
  // The report's `x` wipes the report and deletes nothing: the entries stay in the
  // bell, which is where the detail lives (22.2 item 3).
  const dismissDigest = useCallback(() => setDigest(null), []);

  // **Unread count (derived)**
  const unreadCount = notifications.filter((n) => !n.read).length;

  // **The session socket: frames and the connect snapshot**
  // Keyed on the id and the socket, not the whole user object: a profile refresh
  // replaces `user` and must not tear down a shared connection's listeners. The store
  // mints the socket once per signed-in account, so an identity change here is an
  // account change: a reconnect keeps the same socket and therefore the same report.
  useEffect(() => {
    if (!userId) {
      setNotifications([]);
      setToasts([]);
      setFriendPresence({});
      setDigest(null);
      digestArmed.current = false;
      setUnavailable(false);
      return;
    }

    // A new account or a new socket starts from the server's snapshot below.
    setNotifications([]);
    setToasts([]);
    setFriendPresence({});
    setDigest(null);
    digestArmed.current = false;

    if (!sessionSocket) {
      // No transport at all (a guest, or the socket is still being created).
      setUnavailable(true);
      return;
    }

    const socket = sessionSocket;

    const onSnapshot = (list: Notification[]) => {
      if (!Array.isArray(list)) return;
      // Upsert, never replace: a frame that arrived while this read was in
      // flight stays, and a duplicate id updates in place.
      setNotifications((prev) => mergeById(prev, list));
      // The report is drawn once, from this first snapshot (22.2). It counts every
      // stored type except `profile_updated`, which is the user confirming their own
      // act and already has its own live card. One unread is enough: the rule has to
      // be the same rule at every scale, and one is what a reload most often shows.
      if (!digestArmed.current) {
        digestArmed.current = true;
        const rows = list
          .filter((n) => n.type !== 'profile_updated')
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
        if (rows.length >= 1) setDigest({ rows, total: rows.length });
      }
      setUnavailable(false);
    };

    const onFrame = (notification: Notification) => {
      if (!notification?.id) return;
      // A display-name change is SHORT-LIVED/TRANSIENT: toast only, never the
      // bell/unread badge. The backend targets it at the actor alone
      // (notifyTransient), so nobody else is ever told: show it as-is.
      if (notification.type === 'display_name_changed') {
        setToasts((prev) => [notification, ...prev]);
        return;
      }
      // Friend presence is SHORT-LIVED/TRANSIENT: toast only, never the
      // bell/unread badge (the backend sends these via notifyTransient, so they
      // are not stored). Skip the actor's own tabs defensively.
      if (
        notification.type === 'friend_online' ||
        notification.type === 'friend_offline' ||
        notification.type === 'friend_playing'
      ) {
        const p = notification.payload;
        if (p.userId === userId) return;
        // The dot's only live source (D2): the record itself says nothing about
        // presence, and the list is no longer polled. `friend_playing` is the M3 edge
        // that keeps the duel gate honest: a friend in a match reads `playing`, not
        // a stale `online`.
        const friendId = typeof p.userId === 'string' ? p.userId : null;
        if (friendId) {
          const presence =
            notification.type === 'friend_playing'
              ? 'playing'
              : notification.type === 'friend_online'
                ? 'online'
                : 'offline';
          setFriendPresence((prev) => ({ ...prev, [friendId]: presence }));
        }
        setToasts((prev) => [notification, ...prev]);
        return;
      }
      // Avatar changes are transient: no bell entry, no toast. The backend pushes
      // them to the owner alone, which keeps the owner's other tabs in step. Other
      // accounts pick the change up on their next profile or roster fetch.
      if (notification.type === 'avatar_changed') {
        const p = notification.payload;
        const changedId = typeof p.userId === 'string' ? p.userId : '';
        if (changedId) {
          applyAvatarChange(changedId, {
            has: p.has === true,
            style: typeof p.style === 'string' ? p.style : undefined,
            // The stamp becomes the photo URL's `?v=`, forcing a real fetch.
            v: typeof p.v === 'number' ? p.v : undefined,
          });
        }
        return;
      }
      // Stored arrival: the bell takes it, and it gets its own card. The report was
      // drawn at boot and never grows a row from a live frame (22.2).
      setNotifications((prev) => mergeById(prev, [notification]));
    };

    const onConnect = () => setUnavailable(false);
    const onDisconnect = () => setUnavailable(true);

    socket.on('notifications:unread', onSnapshot);
    socket.on('notification', onFrame);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    setUnavailable(!socket.connected);

    return () => {
      socket.off('notifications:unread', onSnapshot);
      socket.off('notification', onFrame);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [sessionSocket, userId]);

  // **Actions**

  /** Mark a single notification as read: the server deletes it, so the bell
   * drops the id rather than flagging it (delete-on-read, D12). */
  const markRead = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    setToasts((prev) => prev.filter((n) => n.id !== id));
    announceRead([id]);
    apiFetch(`/api/notifications/${id}/read`, { method: 'PATCH' }).catch(() => {});
  }, []);

  /** Read many entries in one round trip: a row click that prunes the rows it
   * speaks for (22.3). The cards for those ids go too, since an entry that
   * exists no longer has a card to show. */
  const markReadMany = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const gone = new Set(ids);
    setNotifications((prev) => prev.filter((n) => !gone.has(n.id)));
    setToasts((prev) => prev.filter((n) => !gone.has(n.id)));
    announceRead(ids);
    postApi('/api/notifications/read', { ids }).catch(() => {});
  }, []);

  /** Mark all notifications as read: both keys are deleted server-side. */
  const markAllRead = useCallback(() => {
    announceRead(notifications.map((n) => n.id));
    setNotifications([]);
    setToasts([]);
    apiFetch('/api/notifications/read-all', { method: 'POST' }).catch(() => {});
  }, [notifications]);

  /** The only way a card leaves (22.3). The card's `x` and every action button
   * pass `read`, so the entry goes with it; the clock passes `timeout`, so the
   * card hides and the entry waits unread in the bell. */
  const dismissToast = useCallback(
    (id: string, reason: ToastDismissReason = 'timeout') => {
      setToasts((prev) => prev.filter((n) => n.id !== id));
      if (reason === 'read') markReadMany([id]);
    },
    [markReadMany],
  );

  // **Every tab hears a deletion**
  // The three mutations above write one `storage` key; this tab never receives
  // its own event, which is why they also drop the ids locally. A tab that was
  // offline during a delete simply never receives that entry from its next
  // snapshot: no watermark, no replay (22.3 item 5).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== NOTIF_READ_KEY || !e.newValue) return;
      let ids: string[];
      try {
        const parsed = JSON.parse(e.newValue) as { ids?: unknown };
        ids = Array.isArray(parsed.ids)
          ? parsed.ids.filter((id): id is string => typeof id === 'string')
          : [];
      } catch {
        return;
      }
      if (ids.length === 0) return;
      const gone = new Set(ids);
      setNotifications((prev) => prev.filter((n) => !gone.has(n.id)));
      setToasts((prev) => prev.filter((n) => !gone.has(n.id)));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = useMemo(
    () => ({
      notifications,
      toasts,
      unreadCount,
      markRead,
      markReadMany,
      markAllRead,
      dismissToast,
      friendPresence,
      bellOpen,
      setBellOpen,
      openBell,
      digest,
      dismissDigest,
      unavailable,
    }),
    [
      notifications,
      toasts,
      unreadCount,
      markRead,
      markReadMany,
      markAllRead,
      dismissToast,
      friendPresence,
      bellOpen,
      openBell,
      digest,
      dismissDigest,
      unavailable,
    ],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

// **Hook**

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    return {
      notifications: [],
      toasts: [],
      unreadCount: 0,
      markRead: () => {},
      markReadMany: () => {},
      markAllRead: () => {},
      dismissToast: () => {},
      friendPresence: {},
      bellOpen: false,
      setBellOpen: () => {},
      openBell: () => {},
      digest: null,
      dismissDigest: () => {},
      unavailable: false,
    };
  }
  return ctx;
}

// The presence map alone, for the friends lists: they need the dots without the
// bell, and this keeps the fallback (no provider) a stable empty object.
const NO_PRESENCE: Record<string, PresenceStatus> = {};

export function useFriendPresence(): Record<string, PresenceStatus> {
  const ctx = useContext(NotificationsContext);
  return ctx?.friendPresence ?? NO_PRESENCE;
}

