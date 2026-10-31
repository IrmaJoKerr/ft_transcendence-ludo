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
import { apiFetch } from '../api';
import { applyAvatarChange } from '../avatarCache';
import type { Notification } from '../sessionSocket';

// **Types**

// The wire shape is owned by the transport (sessionSocket.ts); the bell and the
// toasts read it through this module, so every consumer keeps its old import.
export type { Notification, NotificationType } from '../sessionSocket';
export type InAppNotification = Notification;

// A burst of stored arrivals becomes one digest toast instead of N toasts.
const DIGEST_WINDOW_MS = 2_000;

interface NotificationsContextValue {
  notifications: Notification[];
  toasts: Notification[];
  unreadCount: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
  dismissToast: (id: string) => void;
  /** The last presence edge each friend's account announced on this connection.
   * The friends lists read it for their dots now that they are not polled. */
  friendPresence: Record<string, 'online' | 'offline'>;
  /** The bell panel's open state: the navbar's trigger and the digest toast both
   * drive it, so it cannot live in the navbar's local state. */
  bellOpen: boolean;
  setBellOpen: (open: boolean) => void;
  openBell: () => void;
  /** How many stored arrivals the digest toast is announcing (0 = hidden). */
  digestCount: number;
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

// The digest shows once per tab (sessionStorage survives a reload in that tab):
// the badge is the honest place for everything after the first burst. Storage can
// be blocked (private modes), and then showing it is better than losing it.
function claimDigest(userId: string): boolean {
  const key = `notif-digest-shown:${userId}`;
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1');
    return true;
  } catch {
    return true;
  }
}
// **Provider**

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user, sessionSocket } = useApp();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [toasts, setToasts] = useState<Notification[]>([]);
  // userId -> the last presence edge seen on this stream. A transient toast is
  // dismissed; this map is not: it is what keeps a friend's dot honest between
  // the list's first paint and the next repair fetch.
  const [friendPresence, setFriendPresence] = useState<Record<string, 'online' | 'offline'>>({});
  const [bellOpen, setBellOpen] = useState(false);
  const [digestCount, setDigestCount] = useState(0);
  const [unavailable, setUnavailable] = useState(false);
  // The digest window: frames counted since the burst began, and its timer.
  const digestPending = useRef(0);
  const digestTimer = useRef<number | null>(null);

  const userId = user?.id;

  const openBell = useCallback(() => {
    setBellOpen(true);
    setDigestCount(0);
  }, []);
  const dismissDigest = useCallback(() => setDigestCount(0), []);

  // **Unread count (derived)**
  const unreadCount = notifications.filter((n) => !n.read).length;

  // **The session socket: frames and the connect snapshot**
  // Keyed on the id and the socket, not the whole user object: a profile refresh
  // replaces `user` and must not tear down a shared connection's listeners.
  useEffect(() => {
    if (!userId) {
      setNotifications([]);
      setToasts([]);
      setFriendPresence({});
      setDigestCount(0);
      setUnavailable(false);
      return;
    }

    // A new account or a new socket starts from the server's snapshot below.
    setNotifications([]);
    setToasts([]);
    setFriendPresence({});
    setDigestCount(0);
    digestPending.current = 0;

    if (!sessionSocket) {
      // No transport at all (a guest, or the socket is still being created).
      setUnavailable(true);
      return;
    }

    const socket = sessionSocket;

    // The digest: a burst of stored arrivals becomes one toast. Transient frames
    // keep their own toasts and never enter this buffer.
    const flushDigest = (count: number) => {
      digestPending.current = 0;
      digestTimer.current = null;
      if (count === 0) return;
      if (!claimDigest(userId)) return;
      setDigestCount(count);
    };
    const queueDigest = () => {
      digestPending.current += 1;
      if (digestTimer.current !== null) return;
      digestTimer.current = window.setTimeout(
        () => flushDigest(digestPending.current),
        DIGEST_WINDOW_MS,
      );
    };

    const onSnapshot = (list: Notification[]) => {
      if (!Array.isArray(list)) return;
      // Upsert, never replace: a frame that arrived while this read was in
      // flight stays, and a duplicate id updates in place.
      setNotifications((prev) => mergeById(prev, list));
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
      if (notification.type === 'friend_online' || notification.type === 'friend_offline') {
        const p = notification.payload;
        if (p.userId === userId) return;
        // The dot's only live source (D2): the record itself says nothing about
        // presence, and the list is no longer polled.
        const friendId = typeof p.userId === 'string' ? p.userId : null;
        if (friendId) {
          const presence = notification.type === 'friend_online' ? 'online' : 'offline';
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
      // Stored arrival: the bell takes it, and the digest speaks for the burst.
      setNotifications((prev) => mergeById(prev, [notification]));
      queueDigest();
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
      if (digestTimer.current !== null) {
        window.clearTimeout(digestTimer.current);
        digestTimer.current = null;
      }
    };
  }, [sessionSocket, userId]);

  // **Actions**

  /** Mark a single notification as read: the server deletes it, so the bell
   * drops the id rather than flagging it (delete-on-read, D12). */
  const markRead = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    apiFetch(`/api/notifications/${id}/read`, { method: 'PATCH' }).catch(() => {});
  }, []);

  /** Mark all notifications as read: both keys are deleted server-side. */
  const markAllRead = useCallback(() => {
    setNotifications([]);
    apiFetch('/api/notifications/read-all', { method: 'POST' }).catch(() => {});
  }, []);

  /** Dismiss a toast (remove from the transient toast queue). */
  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const value = useMemo(
    () => ({
      notifications,
      toasts,
      unreadCount,
      markRead,
      markAllRead,
      dismissToast,
      friendPresence,
      bellOpen,
      setBellOpen,
      openBell,
      digestCount,
      dismissDigest,
      unavailable,
    }),
    [
      notifications,
      toasts,
      unreadCount,
      markRead,
      markAllRead,
      dismissToast,
      friendPresence,
      bellOpen,
      openBell,
      digestCount,
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
      markAllRead: () => {},
      dismissToast: () => {},
      friendPresence: {},
      bellOpen: false,
      setBellOpen: () => {},
      openBell: () => {},
      digestCount: 0,
      dismissDigest: () => {},
      unavailable: false,
    };
  }
  return ctx;
}

// The presence map alone, for the friends lists: they need the dots without the
// bell, and this keeps the fallback (no provider) a stable empty object.
const NO_PRESENCE: Record<string, 'online' | 'offline'> = {};

export function useFriendPresence(): Record<string, 'online' | 'offline'> {
  const ctx = useContext(NotificationsContext);
  return ctx?.friendPresence ?? NO_PRESENCE;
}

