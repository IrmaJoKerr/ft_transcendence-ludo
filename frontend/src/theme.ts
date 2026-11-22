// The four Ludo seat colours. `base` is the only field: colour identifies the seat, and
// the board never dims a seat by changing this value.
export const COL = {
  red: { base: '#ff007f' },
  green: { base: '#00ff88' },
  yellow: { base: '#ffe600' },
  blue: { base: '#00f0ff' },
} as const;

export type ColorKey = keyof typeof COL;

// Turn order: blue → red → green → yellow, independent of seat index. Engine-owned; the
// picker, board and waiting rail read their geometry from here.
export const SEAT_COLORS: ColorKey[] = ['blue', 'red', 'green', 'yellow'];

// The picker's 2×2 in board-quadrant order (row-major): red and green on top,
//  blue and yellow below — the corners the board draws. Display geometry only:
//  turn order is `SEAT_COLORS`.
export const BOARD_QUADRANTS: ColorKey[] = ['red', 'green', 'blue', 'yellow'];

// The localised colour word for a corner (`lobby.color*`), shared by every
//  screen that names a seat and by the engine's `bot-<color>` ids.
export const COLOR_KEYS: Record<ColorKey, string> = {
  red: 'lobby.colorRed',
  green: 'lobby.colorGreen',
  yellow: 'lobby.colorYellow',
  blue: 'lobby.colorBlue',
};

// Bot assistant names, shown as-is; the host is never a bot, so 3 is enough.
export const BOT_POOL = ['Siri', 'Alexa', 'Cortana'];

// Mirrors backend/src/presence/presence.service.ts's PresenceStatus.
export type PresenceStatus = 'online' | 'playing' | 'offline';

export const STATUS_STYLE: Record<PresenceStatus, { color: string; label: string }> = {
  online: { color: '#4bbf7b', label: 'Online' },
  playing: { color: '#f0c24e', label: 'In a game' },
  offline: { color: '#6b6255', label: 'Offline' },
};
