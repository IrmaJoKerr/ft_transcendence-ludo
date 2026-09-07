import { GameState, PlayerColor, LegalMove, PieceId, MoveResult } from './types';
import { BoardMapper } from './board-mapper';

// MoveValidator - determines legal moves, resolves captures, checks wins, and executes moves.
export class MoveValidator {
  // All legal moves for `color` given the dice roll: prison exits (6 only),
  // normal track moves with blockade checks, home entries. Used by
  // LudoEngine.rollDice to build pendingLegalMoves.
  static getLegalMoves(state: GameState, color: PlayerColor, diceValue: number): LegalMove[] {
    const moves: LegalMove[] = [];
    
    for (const piece of state.pieces.filter(p => p.color === color)) {
      const from = piece.step;
      
      // Skip if exited (step < 0)
      if (from < 0) continue;
      
      // Skip if already finished (step === 57)
      if (from === 57) continue;
      
      // Prison exit rule: can only leave prison on a roll of 6.
      // Exiting places the piece on the starting track square (step 1) : the 6
      // is consumed to exit; the remaining 5 steps are NOT applied. The next
      // roll then moves the piece 1-6 steps.
      if (from === 0) {
        if (diceValue !== 6) continue;
        const to = 1;
        const isHomeEntry = false;
        const isCapture = this.isCapturableTarget(state, color, piece.id, to);
        moves.push({ pieceId: piece.id, from, to, isCapture, isHomeEntry });
        continue;
      }
      
      const to = from + diceValue;
      if (to > 57) continue; // overshoot
      
      // Blockade rule: cannot pass THROUGH a two-or-more same-color opponent stack.
      // Any intermediate track step the piece would cross is blocked.
      if (this.blockadeBlocksPath(state, color, from, to, piece.id)) {
        continue;
      }
      
      const isHomeEntry = to >= 52 && to <= 56;
      const isCapture = this.isCapturableTarget(state, color, piece.id, to);
      
      moves.push({
        pieceId: piece.id,
        from,
        to,
        isCapture,
        isHomeEntry
      });
    }
    
    return moves;
  }

  // True if an opponent blockade (2+ same-color pieces on a non-safe square)
  // lies on the path between `from` (exclusive) and `to` (inclusive). Safe
  // zones never block; the home stretch and goal are immune.
  static blockadeBlocksPath(
    state: GameState,
    moverColor: PlayerColor,
    from: number,
    to: number,
    pieceId: PieceId,
  ): boolean {
    // Moves that never touch the main track can't be blocked.
    if (from < 1 || to < 1) return false;

    // Opponents' blockades only matter; own pieces never physically block the mover.
    const opponentColors: PlayerColor[] = ['blue', 'red', 'green', 'yellow'].filter(c => c !== moverColor) as PlayerColor[];

    // Walk the mover's own-step path, but only main-track steps (1-51) participate.
    // When the move ends in the home stretch/goal (to > 51), still check the
    // intermediate track cells (e.g. step 51) the piece crosses before entering home.
    const lastTrackStep = Math.min(to, 51);
    for (let step = from + 1; step <= lastTrackStep; step++) {
      const moverPos = BoardMapper.toTrackPosition(pieceId, step);
      if (moverPos === -1) continue;
      // Safe zones never form a blockade : skip them so a stack there doesn't
      // block (unless the safe-zones mod is OFF, then a stack on a former star
      // can block like any other square).
      if (state.safeZones && BoardMapper.isSafeZoneStep(pieceId, step)) continue;
      for (const blockerColor of opponentColors) {
        if (BoardMapper.isBlockadeAtTrackPos(state.pieces, blockerColor, moverPos)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Single source of truth for "can the mover capture on targetStep?".
   * Detection (getLegalMoves → isCapture) and execution (executeMove) both
   * derive from this one predicate so the two paths can never drift apart.
   * Rules:
   *  - main track only (steps 1-51): home stretch (52-56) and goal (57) are immune
   *  - safe zones are never capturable
   *  - a 2+ same-color opponent blockade is uncapturable (sharing is fine)
   *  - otherwise true iff any opponent piece currently occupies the landing square
   */
  static isCapturableTarget(state: GameState, moverColor: PlayerColor, pieceId: PieceId, targetStep: number): boolean {
    if (targetStep <= 0 || targetStep >= 52) return false;

    // Safe zones (start squares + shared safe loop) never allow captures :
    // unless the safe-zones mod is OFF (hardcore: stars are fair game).
    if (state.safeZones && BoardMapper.isSafeZoneStep(pieceId, targetStep)) return false;

    const targetPos = BoardMapper.toTrackPosition(pieceId, targetStep);
    if (targetPos === -1) return false;

    // Blockade rule: a 2+ same-color opponent stack on the landing square is
    // uncapturable : sharing is fine, capturing is not. The blocker pieces are
    // compared on the shared track loop via the mover's target track position.
    const opponentColors: PlayerColor[] = ['blue', 'red', 'green', 'yellow'].filter(c => c !== moverColor) as PlayerColor[];
    for (const blockerColor of opponentColors) {
      if (BoardMapper.isBlockadeAtTrackPos(state.pieces, blockerColor, targetPos)) {
        return false;
      }
    }

    for (const piece of state.pieces) {
      // Only pieces actually on the main track can be targets; prison (-1/0)
      // and home-stretch/goal pieces map to trackPos -1 and can never match.
      if (piece.color === moverColor || piece.step < 1 || piece.step > 51) continue;
      const boardPos = BoardMapper.toTrackPosition(piece.id, piece.step);
      if (boardPos === targetPos) return true;
    }
    return false;
  }

  /**
   * Every opponent piece occupying the landing square : a stacked block is
   * captured as a whole. Defensive: under legal serialized play, cross-color
   * sharing is impossible outside safe zones and same-color blockades (a move
   * onto an occupied non-safe square always captures), so this normally finds
   * a single color's block at most. Keeping the whole-square rule means even
   * a future rule change can't silently leave defenders on the square.
   */
  static findPiecesAtPosition(state: GameState, excludeColor: PlayerColor, targetStep: number): PieceId[] {
    if (targetStep <= 0 || targetStep >= 52) return [];

    const targetPos = BoardMapper.toTrackPosition(`${excludeColor}-0`, targetStep);
    const found: PieceId[] = [];
    for (const piece of state.pieces) {
      if (piece.color === excludeColor || piece.step < 1 || piece.step > 51) continue;

      const boardPos = BoardMapper.toTrackPosition(piece.id, piece.step);
      if (boardPos === targetPos) found.push(piece.id);
    }
    return found;
  }

  static resolveCapture(state: GameState, capturerColor: PlayerColor, targetStep: number): PieceId[] {
    return this.findPiecesAtPosition(state, capturerColor, targetStep);
  }

  static checkWinner(state: GameState): PlayerColor | null {
    for (const player of state.players) {
      const playerPieces = state.pieces.filter(p => p.color === player.color);
      if (playerPieces.every(p => p.step === 57)) {
        return player.color;
      }
    }
    return null;
  }

  static countPiecesInGoal(state: GameState, color: PlayerColor): number {
    return state.pieces.filter(p => p.color === color && p.step === 57).length;
  }

  static executeMove(state: GameState, pendingMove: LegalMove, diceValue: number): MoveResult {
    const piece = state.pieces.find(p => p.id === pendingMove.pieceId)!;
    const capturerColor = piece.color;
    
    // Move piece
    piece.step = pendingMove.to;
    
    // Resolve capture : every opponent piece stacked on the landing square goes home
    let capturedPieceIds: PieceId[] = [];
    if (pendingMove.isCapture) {
      capturedPieceIds = this.resolveCapture(state, capturerColor, pendingMove.to);
      for (const id of capturedPieceIds) {
        const captured = state.pieces.find(p => p.id === id)!;
        captured.step = 0;
      }
      if (capturedPieceIds.length > 0) {
        const capturer = state.players.find(p => p.color === capturerColor)!;
        capturer.stats.captures += capturedPieceIds.length;
      }
    }
    
    // Update player turn count
    const player = state.players.find(p => p.color === capturerColor)!;
    player.stats.turns++;
    
    // Build result. path is every intermediate square the piece actually
    // crosses (from+1 .. to) : server-authoritative so the frontend animates
    // the real route instead of re-deriving it (and can't skip captures).
    const captured = capturedPieceIds.length > 0;
    const path: number[] = [];
    for (let s = pendingMove.from + 1; s <= pendingMove.to; s++) path.push(s);
    return {
      ply: state.moveCounter + 1,
      color: capturerColor,
      diceValue,
      pieceId: pendingMove.pieceId,
      from: pendingMove.from,
      path,
      to: pendingMove.to,
      captured,
      capturedPieceIds,
      enteredHome: pendingMove.isHomeEntry,
      bonusRoll: diceValue === 6 || captured
    };
  }
}