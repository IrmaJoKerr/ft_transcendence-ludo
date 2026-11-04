// Every chat number the three builds count, in one file: the lobby, the room and both
// composers import from here, and no tree keeps a copy. Before 2026-11-04 the same
// values were declared three times under three names (`CHAT_MAX_CHARS`,
// `GAME_CHAT_MAX_CHARS`, `CHAT_HISTORY`, `GAME_CHAT_MAX_LINES`, ...) and kept in step by
// comments, with one harness asserting a single pair of them.
//
// The two channels keep different scopes on purpose and only the number is shared:
//
// - `CHAT_MAX_CHARS` is one line's length, in UTF-16 units, because that is what
//   `.length` and the wire both count. Every emoji above the BMP costs 2.
// - `CHAT_COOLDOWN_MS` is the lobby's per-socket send spacing AND the room's
//   per-account spacing (keyed `gameId:userId`, so two tabs share one budget).
// - `CHAT_HISTORY` is the lobby transcript: the entry list, trimmed per line, and the
//   exact length of what the card paints on connect (`chat:history`). The dock's plate
//   and the in-game compact slot are only feeds that slice the newest few, so this is
//   the one number a reader can scroll to.
// - `GAME_CHAT_MAX_LINES` is the room's transcript, longer because that same list is
//   the one frozen onto a `MatchHistory` row.
// - `GAME_CHAT_FALLBACK_LINES` is what a room re-posts when a body is refused as too
//   large, and `GAME_CHAT_TTL_S` is a day, the same window the state keeps.

export const CHAT_MAX_CHARS = 300;
export const CHAT_COOLDOWN_MS = 2_000;
export const CHAT_HISTORY = 500;
export const GAME_CHAT_MAX_LINES = 1000;
export const GAME_CHAT_FALLBACK_LINES = 400;
export const GAME_CHAT_TTL_S = 86400;

/** How long a line is, in the one unit both servers count: UTF-16 code units, so an
 *  ordinary character is 1 and anything above the BMP is 2, which is what it also
 *  costs on the wire. Trimmed first, because both servers trim before they measure
 *  (`room-chat.ts` `raw.trim()`, the lobby's `send` the same), so the counter never
 *  charges for the spaces a send will drop. One function for both composers and both
 *  pre-send guards, so the room's `n / 300`, the lobby's, and the two refusals cannot
 *  drift apart. */
export function chatLength(text: string): number {
  return text.trim().length;
}
