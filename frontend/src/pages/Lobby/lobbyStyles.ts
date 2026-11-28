import type { CSSProperties } from 'react';
import type { ColorKey } from '../../theme';
import type { Seat } from '../../store';

export const SEAT_HUES: Record<ColorKey, string> = {
  red: '#ff007f',
  green: '#00ff88',
  yellow: '#ffe600',
  blue: '#00f0ff',
};

// An empty card has no colour yet, so it is drawn neutral rather than coloured.
export const EMPTY_CARD_HUE = '#b8a6e4';

export const REMOVE_SEAT_BTN: CSSProperties = {
  cursor: 'pointer',
  background: 'rgb(var(--state-off-rgb) / 0.15)',
  border: '1px solid var(--state-off)',
  color: 'var(--state-off)',
  borderRadius: 4,
  width: 26,
  height: 26,
  display: 'grid',
  placeItems: 'center',
  fontSize: '0.8rem',
  flex: 'none',
};

export type VisibleSeat = Seat;
