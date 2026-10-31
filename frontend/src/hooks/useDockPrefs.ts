import { useCallback, useEffect, useState } from 'react';

// The dock's shape in one place: the widths, the compact threshold and the chat
// preference. `NavDock` reads all of them from here, so the spacer and the bar
// cannot disagree about how wide they are.

/** Below this viewport width the dock is the 88 px icon rail: no labels, no
 *  chat panel, no toggle. */
export const WIDE_MIN_PX = 1280;

/** The two dock widths, in px: the icon rail, and the full dock. */
export const DOCK_RAIL_PX = 88;
export const DOCK_CHAT_PX = 360;

/** One localStorage key per preference, in the same `retro_` family as `retro_crt`. */
const CHAT_KEY = 'retro_chat';

// Read synchronously on first render so a page never paints one chat state and
// then flips to the other. Storage can be blocked (private modes); the answer is
// then the default, ON, rather than a screen nobody can turn back on.
function readChatOn(): boolean {
  try {
    return localStorage.getItem(CHAT_KEY) !== 'false';
  } catch {
    return true;
  }
}

function readCompact(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < WIDE_MIN_PX;
}

export interface DockPrefs {
  /** The chat screen is powered on. It does not change the dock's width: the
   *  screen lights up inside the slot it already occupies. */
  chatOn: boolean;
  toggleChat: () => void;
  /** The viewport is under WIDE_MIN_PX: the dock is the icon rail. */
  isCompact: boolean;
  /** The dock's width in px: the one number the spacer and the bar both use. */
  width: number;
}

export function useDockPrefs(): DockPrefs {
  const [chatOn, setChatOn] = useState(readChatOn);
  const [isCompact, setIsCompact] = useState(readCompact);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${WIDE_MIN_PX - 1}px)`);
    const handler = () => setIsCompact(mq.matches);
    handler();
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const toggleChat = useCallback(() => {
    setChatOn((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(CHAT_KEY, next ? 'true' : 'false');
      } catch {
        // Storage blocked: the preference lasts for this tab only.
      }
      return next;
    });
  }, []);

  // One width per breakpoint, never one per chat state. A dock that resizes when
  // a decoration toggles drags the whole page sideways, and re-wraps every column
  // of the dashboard under whoever is reading it; the chat lights up inside the
  // slot it already occupies instead (`LobbyChat`).
  const width = isCompact ? DOCK_RAIL_PX : DOCK_CHAT_PX;
  return { chatOn, toggleChat, isCompact, width };
}
