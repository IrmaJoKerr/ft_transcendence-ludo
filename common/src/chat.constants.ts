// Chat limits shared by all builds: line length in UTF-16 units, cooldowns, and
// transcript sizes. The lobby and room scope the values differently; the room
// transcript is longer because it is frozen onto a match row.
import { GAME_STATE_TTL_S } from './timing.constants';

export const CHAT_MAX_CHARS = 300;
export const CHAT_COOLDOWN_MS = 2_000;
export const CHAT_HISTORY = 500;
export const GAME_CHAT_MAX_LINES = 1000;
export const GAME_CHAT_FALLBACK_LINES = 400;
export const GAME_CHAT_TTL_S = GAME_STATE_TTL_S;

// A line's length after trim, in UTF-16 units: the same unit both composers and
// the server guards count.
export function chatLength(text: string): number {
  return text.trim().length;
}
