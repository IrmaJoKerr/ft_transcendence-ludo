import type { CSSProperties } from 'react';
import type { LobbyRoom } from '../../sessionSocket';
import type { PlayerColor } from '../../game/types';
import { COL, SEAT_COLORS, type ColorKey } from '../../theme';

export type Room = LobbyRoom;

export type MatchResult = {
  gameId: string;
  token: string;
  engineUrl: string;
  color: PlayerColor;
  inviteCode?: string;
  mode: 'pvp' | 'pve' | 'hotseat';
  playerCount: number;
};

export const ROOM_AVATAR_HUES = [COL.red.base, COL.green.base, COL.yellow.base, COL.blue.base];

// The corners a room still offers, narrowed to the palette's key type.
export function claimableColors(free?: string[]): ColorKey[] {
  const pool = free ?? SEAT_COLORS;
  return SEAT_COLORS.filter((color) => pool.includes(color));
}

export function hueForHost(host: string): string {
  let hash = 0;
  for (let i = 0; i < host.length; i++) hash = (hash * 31 + host.charCodeAt(i)) >>> 0;
  return ROOM_AVATAR_HUES[hash % ROOM_AVATAR_HUES.length];
}

export const ROOM_GRID_COLUMNS =
  'minmax(0, 0.95fr) minmax(0, 1.45fr) minmax(0, 0.7fr) minmax(0, 0.85fr) minmax(0, 1.55fr) 104px';

export const ROOM_MODES = [
  { key: 'clashEnabled', icon: '⚔️', label: 'game.clashMode', hue: '#ff007f' },
  { key: 'captureFx', icon: '💥', label: 'game.captureFx', hue: '#00ff88' },
  { key: 'freeExit', icon: '🚪', label: 'game.freeExit', hue: '#ffe600' },
  { key: 'noSafeZones', icon: '💀', label: 'game.noSafeZones', hue: '#00f0ff' },
] as const;

export const BASE_MODE_HUE = '#b8a6e4';

export function modeChipStyle(hue: string): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    padding: '2px 5px',
    borderRadius: 4,
    border: `1px solid ${hue}66`,
    background: `${hue}1f`,
    color: hue,
    fontFamily: 'var(--font-mono)',
    fontSize: '0.58rem',
    fontWeight: 'bold',
    letterSpacing: '0.3px',
    lineHeight: 1.35,
    whiteSpace: 'nowrap',
    textTransform: 'uppercase',
  };
}

export const HEADER_ACTION_STYLE: CSSProperties = {
  height: 32,
  padding: '0 14px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '0.72rem',
  fontFamily: 'var(--font-mono)',
  fontWeight: 700,
  letterSpacing: '0.4px',
  background: 'rgb(var(--accent-cyan-rgb) / 0.22)',
  borderColor: 'var(--accent-cyan)',
  color: 'var(--accent-cyan)',
  boxShadow: '0 0 16px rgb(var(--accent-cyan-rgb) / 0.4)',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

export function badgeStyle(
  badge: 'ranked' | 'semiRanked' | 'casual' | 'invite',
): CSSProperties {
  const hue =
    badge === 'ranked'
      ? '#ffe600'
      : badge === 'semiRanked'
        ? '#00ff88'
        : badge === 'casual'
          ? '#00f0ff'
          : '#ff007f';
  return {
    fontSize: '0.65rem',
    fontWeight: 'bold',
    letterSpacing: '0.5px',
    color: hue,
    background: `${hue}22`,
    border: `1px solid ${hue}66`,
    borderRadius: 4,
    padding: '2px 8px',
    fontFamily: 'var(--font-mono)',
    textTransform: 'uppercase',
  };
}
