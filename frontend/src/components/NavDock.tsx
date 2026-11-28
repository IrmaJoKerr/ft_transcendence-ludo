import type { CSSProperties } from 'react';
import { RetroNavbar } from './RetroNavbar';
import { useDockPrefs } from '../hooks/useDockPrefs';
import type { Notification } from '../hooks/useNotifications';

// The seated navigation dock: one sticky spacer, one width and one chat preference.
// Docked pages mount it instead of an `<aside>` + `<RetroNavbar>` pair, so the spacer,
// bar width and `xl` threshold cannot disagree. Mounting it also opts the page into chat.
interface NavDockProps {
  // The nav item to highlight; `RetroNavbar` falls back to the router.
  activeRoute: string;
  notifications?: Notification[];
  unreadCount?: number;
  onMarkRead?: (id: string) => void;
  onMarkAllRead?: () => void;
}

export function NavDock({
  activeRoute,
  notifications,
  unreadCount,
  onMarkRead,
  onMarkAllRead,
}: NavDockProps) {
  const { chatOn, toggleChat, isCompact, width } = useDockPrefs();

  // The spacer owns the width; the bar fills it. The width changes only at the
  // compact breakpoint, which is a viewport event, so there is nothing to
  // animate: throwing the chat switch must not move the page.
  const spacerStyle: CSSProperties = {
    width,
    margin: 0,
    padding: 0,
  };

  return (
    <aside className="sticky top-8 shrink-0" style={spacerStyle}>
      <RetroNavbar
        activeRoute={activeRoute}
        isCompact={isCompact}
        chatOn={chatOn}
        onToggleChat={toggleChat}
        notifications={notifications}
        unreadCount={unreadCount}
        onMarkRead={onMarkRead}
        onMarkAllRead={onMarkAllRead}
      />
    </aside>
  );
}
