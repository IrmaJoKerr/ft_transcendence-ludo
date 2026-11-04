// The Wall Breaker mechanic's two numbers, in one file. Copied from
// `backend/app/ludo-engine/src/types.ts`, which was the only declarer on 2026-11-04; the
// SPA reads the cap to draw one slot per possible token, so tuning the hand without the
// board is exactly the drift this folder exists to stop.
//
// The lesson of the rest of the board is the opposite and deliberate: the track length,
// the step bounds, the safe squares and the 15 x 15 grid are board TOPOLOGY, not
// tunables, so they stay mirrored in each tree (a board redesign touches both drawings
// anyway) and a harness keeps them equal.

/** Tokens every seat is dealt at game start. One token buys one landing on a wall the
 *  roll reaches exactly. */
export const STARTING_WALL_BREAKER_TOKENS = 1;

/** The hand's ceiling. The seed is one and a clash won against one defender pays one
 *  back, so a seat banks at most three attempts; a won barrier never pays, so a wall
 *  cannot feed the token that breaks walls. The SPA draws this many glyph slots, so an
 *  empty hand reads as empty rather than as a row that vanished. */
export const WALL_BREAKER_TOKEN_CAP = 3;
