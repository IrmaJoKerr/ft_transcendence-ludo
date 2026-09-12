import { GameState, MoveResult, PlayerColor } from './types';
import { MoveValidator } from './move-validator';
import { advanceTurnInState } from './player-handler';

// Apply a move's outcome: sync piece mirrors, bump the counter, run the win
// check, update stats/bonus, and advance the turn (or re-roll on 6/capture).
// Pure mutation : persistence/emission stay with the caller.
// Shared by movePiece and clash resolution (attackerWon=false → repulse:
// the attacker lost the QTE, no bonus roll and the turn always advances).
export function applyMoveOutcome(
  state: GameState,
  result: MoveResult,
  diceValue: number,
  attackerWon = true,
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
    const piecesInGoal = MoveValidator.countPiecesInGoal(state, winner);
    const winnerPlayer = state.players.find((p) => p.color === winner);
    if (winnerPlayer) {
      winnerPlayer.stats.piecesInGoal = piecesInGoal;
      winnerPlayer.piecesInGoal = piecesInGoal;
      winnerPlayer.isFinished = true;
      winnerPlayer.finishedAt = new Date().toISOString();
    }
    state.status = 'finished';
    state.winner = winner;
    state.resultDetail = 'four_pieces';
  } else {
    // Game continues: refresh the mover's piecesInGoal (display) and reset
    // hasRolled so the next turn starts clean.
    const mover = state.players.find((p) => p.color === result.color);
    const sixBonus = diceValue === 6;
    if (mover) {
      mover.piecesInGoal = MoveValidator.countPiecesInGoal(state, result.color);
      mover.hasRolled = false;
      // bonusRoll tells the frontend to let the SAME player roll again.
      if (attackerWon) {
        mover.bonusRoll = sixBonus || result.captured;
      } else {
        // Repulse: the attacker lost the clash : no bonus even on a 6.
        mover.bonusRoll = false;
      }
    }
    // Turn hand-off: a 6 or an actual capture re-rolls the same player
    // (turnPhase back to WAITING_FOR_ROLL, no advance); anything else advances
    // to the next active seat. A repulse always advances regardless of the die.
    if (!attackerWon) {
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
