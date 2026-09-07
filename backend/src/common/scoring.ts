export const POINTS_PER_PIECE = 2;
export const WIN_BONUS_PIECE = 1;

// Points awarded for one game: each piece that reached the goal scores
// POINTS_PER_PIECE (halved for PvE), plus a bonus piece for the winner.
// ratingDeltaFor() converts a finished game's result into a rating delta.
//
//  Users:
// - Match post-game (match.postgame.service.ts): after a real match ends it
//   computes each human player's delta via ratingDeltaFor() and applies it to
//   User.rating (bots are skipped, so they never get rating changes).
// - User (user.service.ts): when it serves a profile / game history it derives
//   the same per-game `ratingDelta` so clients can show how much a match moved
//   the rating.
//
// The two constants are only read by ratingDeltaFor() — nothing imports
// POINTS_PER_PIECE / WIN_BONUS_PIECE directly.
export function ratingDeltaFor(input: {
  piecesInGoal: number;
  rank: number;
  gameType: 'PVP' | 'PVE';
}): number {
  const effectivePieces = (input.piecesInGoal ?? 0) + (input.rank === 1 ? WIN_BONUS_PIECE : 0);
  const perPiece = input.gameType === 'PVE' ? POINTS_PER_PIECE / 2 : POINTS_PER_PIECE;
  return effectivePieces * perPiece;
}
