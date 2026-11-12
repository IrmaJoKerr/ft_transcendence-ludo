/** The four Ludo player colors. `base` is the only field anything reads: it is
 *  the seat, and colour is the seat (see 9.1 — the board itself is never dimmed,
 *  only the unfilled seat pills are, and they dim the pill rather than the
 *  quadrant). A `dark` and a `yard` value used to sit here for a dimmed
 *  home-quadrant fill the board stopped painting; nothing referenced either, and
 *  the sweep counts them among the literals it removes. */
export const COL = {
  red: { base: '#ff007f' },
  green: { base: '#00ff88' },
  yellow: { base: '#ffe600' },
  blue: { base: '#00f0ff' },
} as const;

export type ColorKey = keyof typeof COL;

/** Turn order, and only that: a seat holds whatever colour it claimed, and the
 *  rotation visits these in this order (blue → red → green → yellow) whatever
 *  index a seat sits at. Engine-owned — the picker, the board and the waiting
 *  rail all read their geometry from here. */
export const SEAT_COLORS: ColorKey[] = ['blue', 'red', 'green', 'yellow'];

/** The picker's 2×2 in board-quadrant order (row-major): red and green on top,
 *  blue and yellow below — the corners the board draws. Display geometry only:
 *  turn order is `SEAT_COLORS`. */
export const BOARD_QUADRANTS: ColorKey[] = ['red', 'green', 'blue', 'yellow'];

/** The localised colour word for a corner (`lobby.color*`), shared by every
 *  screen that names a seat and by the engine's `bot-<color>` ids. */
export const COLOR_KEYS: Record<ColorKey, string> = {
  red: 'lobby.colorRed',
  green: 'lobby.colorGreen',
  yellow: 'lobby.colorYellow',
  blue: 'lobby.colorBlue',
};

/**
 * Bot assistant names, shown as-is; the host is never a bot, so 3 is enough.
 */
export const BOT_POOL = ['Siri', 'Alexa', 'Cortana'];

/** Mirrors backend/src/presence/presence.service.ts's PresenceStatus. */
export type PresenceStatus = 'online' | 'playing' | 'offline';

export const STATUS_STYLE: Record<PresenceStatus, { color: string; label: string }> = {
  online: { color: '#4bbf7b', label: 'Online' },
  playing: { color: '#f0c24e', label: 'In a game' },
  offline: { color: '#6b6255', label: 'Offline' },
};
