import type { CSSProperties } from 'react';

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

export const goldText: CSSProperties = {
  background: 'linear-gradient(180deg,#f4dfa0,#c69a44)',
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: 'transparent',
};

export const btnGold: CSSProperties = {
  border: 'none',
  borderRadius: 12,
  padding: '14px 18px',
  font: "800 15px 'Atkinson Hyperlegible Next', sans-serif",
  color: '#2a1c07',
  cursor: 'pointer',
  background: 'linear-gradient(180deg,#f0d18a,#c99b45)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.55),0 12px 22px -12px rgba(190,140,55,.8)',
};

export const btnGoldSmall: CSSProperties = {
  border: 'none',
  borderRadius: 11,
  padding: '12px 22px',
  font: "800 14px 'Atkinson Hyperlegible Next', sans-serif",
  color: '#2a1c07',
  cursor: 'pointer',
  background: 'linear-gradient(180deg,#f0d18a,#c99b45)',
};

export const btnOutline: CSSProperties = {
  border: '1px solid #4a3826',
  borderRadius: 12,
  padding: '13px 18px',
  font: "700 15px 'Atkinson Hyperlegible Next', sans-serif",
  color: '#e8dcc6',
  cursor: 'pointer',
  background: 'linear-gradient(180deg,#2b2118,#20180f)',
};

export const card: CSSProperties = {
  borderRadius: 16,
  background: 'linear-gradient(180deg,#241b13,#1a130d)',
  border: '1px solid #3a2c1d',
};

export const input: CSSProperties = {
  width: '100%',
  border: '1px solid #43331f',
  borderRadius: 11,
  padding: '12px 14px',
  font: "500 15px 'Atkinson Hyperlegible Next', sans-serif",
  color: '#efe6d6',
  background: '#17110b',
  outline: 'none',
};

export const label: CSSProperties = {
  font: "700 12px 'Atkinson Hyperlegible Next', sans-serif",
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  color: '#a99a83',
};

export const sectionLabel: CSSProperties = {
  font: "700 12px 'Atkinson Hyperlegible Next', sans-serif",
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: '#c99b45',
};

/** Blue "YO" avatar used for the signed-in player. */
export const avatarBlue = (
  size: number,
  fontSize: number,
  radius?: number | string,
): CSSProperties => ({
  width: size,
  height: size,
  flex: 'none',
  borderRadius: radius ?? '50%',
  background: 'linear-gradient(180deg,#4a92e0,#2c66ad)',
  display: 'grid',
  placeItems: 'center',
  fontWeight: 800,
  color: '#0d1b28',
  fontSize,
});

/** Dim neutral avatar for other players. */
export const avatarDim = (size: number): CSSProperties => ({
  width: size,
  height: size,
  flex: 'none',
  borderRadius: '50%',
  display: 'grid',
  placeItems: 'center',
  fontWeight: 800,
  fontSize: 12,
  background: '#2a2016',
  color: '#e8dcc6',
});

export const feltPanel: CSSProperties = {
  borderRadius: 18,
  background: 'radial-gradient(90% 90% at 50% 20%,#22432f,#12261a)',
  border: '1px solid #2e4a38',
};

export const pill = (active: boolean): CSSProperties => ({
  cursor: 'pointer',
  padding: '9px 16px',
  borderRadius: 10,
  fontWeight: 700,
  fontSize: '13.5px',
  color: active ? '#2a1c07' : '#c9bda3',
  background: active ? 'linear-gradient(180deg,#f0d18a,#c99b45)' : '#1a130d',
  border: '1px solid ' + (active ? '#b8873a' : '#3a2c1d'),
});
