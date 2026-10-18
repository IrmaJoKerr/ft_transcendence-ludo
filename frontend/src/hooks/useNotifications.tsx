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

// **Types**

export type NotificationType =
  | 'friend_request'
  | 'friend_accepted'
  | 'friend_removed'
  | 'friend_declined'
  | 'game_invite'
  | 'achievement'
  | 'match_finished'
  | 'match_cancelled'
  | 'profile_updated'
  | 'display_name_changed'
  | 'friend_online'
  | 'friend_offline'
  | 'avatar_changed';

export interface Notification {
  id: string;
  type: NotificationType;
  payload: Record<string, unknown>;
  read: boolean;
  createdAt: string;
}
export type InAppNotification = Notification;

interface NotificationsContextValue {
  notifications: Notification[];
  toasts: Notification[];
  unreadCount: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
  dismissToast: (id: string) => void;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

// **Provider**

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useApp();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [toasts, setToasts] = useState<Notification[]>([]);
  const esRef = useRef<EventSource | null>(null);

  // **Unread count (derived)**
  const unreadCount = notifications.filter((n) => !n.read).length;

  // **Fetch existing unread notifications on mount / login**
  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setToasts([]);
      return;
    }

    let cancelled = false;
    apiFetch('/api/notifications')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Notification[]) => {
        if (!cancelled) setNotifications(data);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [user]);

  // **SSE (Server-Sent Events) connection**
  useEffect(() => {
    // Depend on the stable id, not the whole user object: setUser on avatar
    // upload changes object identity, which would reopen this stream and drop
    // any profile_updated published during the reconnect.
    const userId = user?.id;
    if (!userId) {
      esRef.current?.close();
      esRef.current = null;
      return;
    }

    let es: EventSource | null = null;
    try {
      es = new EventSource('/api/notifications/stream');
      esRef.current = es;

      es.onmessage = (event: MessageEvent) => {
        try {
          if (!event.data) return;
          const notification: Notification = JSON.parse(event.data);
          if (notification.id) {
            // A display-name change is SHORT-LIVED/TRANSIENT: toast only, never the
            // bell/unread badge. The backend targets it at the actor alone
            // (notifyTransient), so nobody else is ever told: show it as-is.
            if (notification.type === 'display_name_changed') {
              setToasts((prev) => [notification, ...prev]);
              return;
            }
            // Friend presence is SHORT-LIVED/TRANSIENT: toast only, never the bell/unread
            // badge (the backend sends these via notifyTransient, so they aren't
            // persisted). Skip the actor's own tabs defensively.
            if (notification.type === 'friend_online' || notification.type === 'friend_offline') {
              const p = notification.payload;
              if (p.userId === userId) return;
              setToasts((prev) => [notification, ...prev]);
              return;
            }
            // Avatar changes are transient: no bell entry, no toast. The backend pushes
            // them to the owner alone, which keeps the owner's other tabs in step. Other
            // accounts pick the change up on their next profile or roster fetch.
            if (notification.type === 'avatar_changed') {
              const p = notification.payload;
              const userId = typeof p.userId === 'string' ? p.userId : '';
              if (userId) {
                applyAvatarChange(userId, {
                  has: p.has === true,
                  style: typeof p.style === 'string' ? p.style : undefined,
                  // The stamp becomes the photo URL's `?v=`, forcing a real fetch.
                  v: typeof p.v === 'number' ? p.v : undefined,
                });
              }
              return;
            }
            setNotifications((prev) => [notification, ...prev]);
            setToasts((prev) => [notification, ...prev]);
          }
        } catch {
          // ignore malformed data
        }
      };

      es.onerror = () => {
        // SSE reconnection handled automatically
      };
    } catch {
      // ignore EventSource failure
    }

    return () => {
      try {
        es?.close();
      } catch {
        // ignore EventSource close failure
      }
      esRef.current = null;
    };
  }, [user?.id]);

  // **Actions**

  /** Mark a single notification as read (removes from bell badge count). */
  const markRead = useCallback((id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    apiFetch(`/api/notifications/${id}/read`, { method: 'PATCH' }).catch(() => {});
  }, []);

  /** Mark all notifications as read. */
  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
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
    }),
    [notifications, toasts, unreadCount, markRead, markAllRead, dismissToast],
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
    };
  }
  return ctx;
}
