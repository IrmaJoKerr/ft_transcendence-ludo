import type { GameState, LogEntry, MoveResult, PlayerColor, PlayerMeta } from './types';
import { MoveValidator } from './move-validator';
import { advanceTurnInState } from './player-handler';
import { pushLog } from './game-log';

// Keep a seat's display count and its per-game tally in step with the board, so
// the end-game payload reports the pieces that are actually home.
function syncPiecesInGoal(state: GameState, player: PlayerMeta): void {
  const inGoal = MoveValidator.countPiecesInGoal(state, player.color);
  player.piecesInGoal = inGoal;
  player.stats.piecesInGoal = inGoal;
}

// The move's lines for the recon panel, written here because this is the one funnel a
// plain move and a resolved clash both pass through, and it runs immediately before
// the caller saves the state. The victim colour comes from the clash fields when the
// engine stamped them: a repulse lists the ATTACKER's own id in capturedPieceIds, so
// reading the victim off that id (as the client used to) names the wrong seat.
function logMoveOutcome(state: GameState, result: MoveResult, attackerWon: boolean): LogEntry[] {
  if (!result.captured) return [];
  const ids = result.capturedPieceIds ?? [];
  const victim = result.defenderColor ?? (ids[0]?.split('-')[0] as PlayerColor | undefined);
  if (!victim || victim === result.color) return [];
  const defenderCount = result.defenderCount ?? ids.length;
  if (!attackerWon) {
    // The attack lost: the mover went home, so this is a repulse, not a capture. The
    // line names a wall when the square stood two or more defenders (nothing was broken
    // — `wallBroken` is false on this branch by definition).
    const wall = defenderCount >= 2;
    return [
      pushLog(state, {
        kind: wall ? 'wallAttackFailed' : 'failcapturePiece',
        color: result.color,
        victim,
      }),
    ];
  }
  const wall = result.wallBroken ?? ids.length >= 2;
  // A broken wall names the re-roll as the wall's reward, so it replaces the plain
  // capture line; anything else that captures logs the capture and then the re-roll.
  if (wall && result.bonusRoll) {
    return [
      pushLog(state, { kind: 'wallBrokenBonusRoll', color: result.color, victim }),
    ];
  }
  const lines = [pushLog(state, { kind: 'capturedPiece', color: result.color, victim, wall })];
  if (result.bonusRoll) {
    lines.push(pushLog(state, { kind: 'bonusRollAgain', color: result.color }));
  }
  return lines;
}

// Apply a move's outcome: sync piece mirrors, bump the counter, run the win check,
// update stats and advance the turn, or re-roll on a 6 or capture. `attackerWon` only
// matters for a clash: a defender who won repulses the attacker, so no re-roll. Returns
// the winner (null while the game runs) and the log lines the move wrote, so the frame
// that announces the move can carry the very entries that were stored.
export function applyMoveOutcome(
  state: GameState,
  result: MoveResult,
  diceValue: number,
  attackerWon: boolean,
): { winner: PlayerColor | null; log: LogEntry[] } {
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

  // The panel's lines for this move, written before the counter's side effects so a
  // reader of the log never sees a line without the move it describes in the state.
  const log = logMoveOutcome(state, result, attackerWon);

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
  return { winner, log };
}
