import type { CSSProperties } from 'react';
import { RetroNavbar } from './RetroNavbar';
import { useDockPrefs } from '../hooks/useDockPrefs';
import type { Notification } from '../hooks/useNotifications';

/**
 * The seated navigation dock: one sticky spacer, one width, one chat preference.
 *
 * Every docked page mounts this instead of an `<aside>` + `<RetroNavbar>` pair,
 * so the spacer and the bar cannot disagree about the width, and the `xl`
 * threshold is one JS constant (`WIDE_MIN_PX`) rather than a `matchMedia` plus
 * six class literals.
 *
 * **The dock lives wherever it is mounted, so the chat needs no route check.**
 * Exactly five screens mount it: Home, Leaderboard, Friends, Profile (own and
 * another pilot's, two call sites) and LudoLobby. `/game`, `/gamelobby/table`
 * (the preparation lobby) and `/guest` mount neither the dock nor the panel:
 * those screens have no room for it, which is why "chat on the home, profile,
 * leaderboard, friends and lobby screens" is true by geometry. A new page opts
 * into the chat by mounting this component, knowingly.
 */
interface NavDockProps {
  /** The nav item to highlight; `RetroNavbar` falls back to the router. */
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
