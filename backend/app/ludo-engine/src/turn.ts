import type { GameState, MoveResult, PlayerColor, PlayerMeta } from './types';
import { MoveValidator } from './move-validator';
import { advanceTurnInState } from './player-handler';

// Keep a seat's display count and its per-game tally in step with the board, so
// the end-game payload reports the pieces that are actually home.
function syncPiecesInGoal(state: GameState, player: PlayerMeta): void {
  const inGoal = MoveValidator.countPiecesInGoal(state, player.color);
  player.piecesInGoal = inGoal;
  player.stats.piecesInGoal = inGoal;
}

// Apply a move's outcome: sync piece mirrors, bump the counter, run the win check,
// update stats and advance the turn, or re-roll on a 6 or capture. `attackerWon` only
// matters for a clash: a defender who won repulses the attacker, so no re-roll.
export function applyMoveOutcome(
  state: GameState,
  result: MoveResult,
  diceValue: number,
  attackerWon: boolean,
): PlayerColor | null {
  // Sync the frontend-compatible piece mirrors. The authoritative field is
  // `step` (all rules read it); isInGoal/isInBase are read by the UI and must
  // stay in lockstep so the board renders correctly after every move.
  const movedPiece = state.pieces.find((p) => p.id === result.pieceId);
  if (movedPiece) {
    movedPiece.isInGoal = result.to === 57; // goal: the piece is finished
    movedPiece.isInBase = result.to <= 0; // prison: back in the starting area
  }
  if (result.captured && result.capturedPieceIds) {
    // Captured pieces were sent home (step 0) by executeMove : mirror that on
    // the frontend fields too.
    for (const id of result.capturedPieceIds) {
      const capturedPiece = state.pieces.find((p) => p.id === id);
      if (capturedPiece) {
        capturedPiece.isInGoal = false;
        capturedPiece.isInBase = true;
      }
    }
  }

  // Increment the game-wide play counter: every move gets a unique number that
  // appears in the recorded move history and in the move result (`result.ply`).
  state.moveCounter++;

  // Win check : the first player with all 4 pieces at step 57 wins.
  const winner = MoveValidator.checkWinner(state);
  if (winner) {
    // Seal the final state: mark the game finished, stamp the winner's
    // completion stats, and set resultDetail so the end-card / result
    // submission can label the finish reason ('four_pieces').
    const winnerPlayer = state.players.find((p) => p.color === winner);
    if (winnerPlayer) {
      syncPiecesInGoal(state, winnerPlayer);
      winnerPlayer.isFinished = true;
      winnerPlayer.finishedAt = new Date().toISOString();
    }
    state.status = 'finished';
    state.winner = winner;
    state.resultDetail = 'four_pieces';
  } else {
    // Game continues: keep the mover's piece count in step with the board and
    // reset hasRolled so the next turn starts clean.
    const mover = state.players.find((p) => p.color === result.color);
    const sixBonus = diceValue === 6;
    if (mover) {
      syncPiecesInGoal(state, mover);
      mover.hasRolled = false;
      // bonusRoll tells the frontend to let the SAME player roll again.
      mover.bonusRoll = sixBonus || result.captured;
    }
    // Turn hand-off: a 6 or an actual capture re-rolls the same player; anything else
    // advances to the next active seat. A repulsed clash attacker never re-rolls, since
    // the defender held the square.
    if (!attackerWon) {
      if (mover) {
        mover.bonusRoll = false;
      }
      state.turnPhase = 'WAITING_FOR_ROLL';
      advanceTurnInState(state);
    } else if (sixBonus || result.captured) {
      state.turnPhase = 'WAITING_FOR_ROLL';
    } else {
      state.turnPhase = 'WAITING_FOR_ROLL';
      advanceTurnInState(state);
    }
  }

  // The pending roll/move snapshot is single-use: clear it so a stale roll or
  // a duplicated move_piece is rejected by the next rollDice/movePiece guard.
  state.pendingLegalMoves = [];
  state.pendingDiceValue = undefined;
  state.pendingIsFirstRoll = undefined;

  // The caller emits game_ended when a winner is returned, otherwise piece_moved.
  return winner;
}
