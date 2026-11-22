import { LANGUAGES, THEMES, type ActiveMatch, type Lang, type Seat, type ThemeType } from './types';
import { SEAT_COLORS, type ColorKey } from '../theme';

export const LANG_KEY = 'lr.lang';
export const THEME_KEY = 'retro_theme';
export const NOTIF_AUTOCLOSE_KEY = 'lr.notifAutoClose';
export const ACTIVE_MATCH_KEY = 'lr.activeMatch';
export const SEATS_KEY = 'lr.seats';
export const ACCESS_TOKEN_REFRESH_MS = 14 * 60 * 1000;

export function emptySeats(): Seat[] {
  return [{ type: 'empty' }, { type: 'empty' }, { type: 'empty' }, { type: 'empty' }];
}

export function storedLang(): Lang {
  const raw = localStorage.getItem(LANG_KEY);
  return LANGUAGES.some((l) => l.code === raw) ? (raw as Lang) : 'en';
}

export function storedTheme(): ThemeType {
  const raw = localStorage.getItem(THEME_KEY);
  return THEMES.some((theme) => theme.id === raw) ? (raw as ThemeType) : 'retro80';
}

// A popup setting that forgets on reload is not a setting (22.5). Absent or
// unreadable means on, which is what both cards already did.
export function storedAutoClose(): boolean {
  try {
    return localStorage.getItem(NOTIF_AUTOCLOSE_KEY) !== 'off';
  } catch {
    // Storage blocked (private modes): the default is on.
    return true;
  }
}

export function storedActiveMatch(): ActiveMatch {
  try {
    const raw = sessionStorage.getItem(ACTIVE_MATCH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function storedSeats(): Seat[] {
  try {
    const raw = sessionStorage.getItem(SEATS_KEY);
    if (!raw) return emptySeats();
    const parsed = JSON.parse(raw) as Array<{ type?: unknown; name?: unknown; color?: unknown }>;
    if (!Array.isArray(parsed) || parsed.length !== 4) return emptySeats();
    // A value written before the colour moved onto the seat has no `color` on its
    // occupied cards, and one colour may never sit on two cards: either fault
    // discards the whole value rather than minting a duplicate.
    const taken = new Set<ColorKey>();
    const seats = parsed.map((seat): Seat => {
      const color = SEAT_COLORS.find((c) => c === seat?.color && !taken.has(c));
      if (!color) return { type: 'empty' };
      taken.add(color);
      const name = typeof seat.name === 'string' && seat.name ? seat.name : '';
      if (seat.type === 'you') return { type: 'you', color };
      if (seat.type === 'bot') return { type: 'bot', name: name || 'Bot', color };
      if (seat.type === 'player') return { type: 'player', name: name || `player-${color}`, color };
      return { type: 'empty' };
    });
    if (parsed.some((seat, i) => seat?.type !== 'empty' && seats[i].type === 'empty')) return emptySeats();
    return seats;
  } catch {
        // a corrupt value is a fresh roster
    return emptySeats();
  }
}
