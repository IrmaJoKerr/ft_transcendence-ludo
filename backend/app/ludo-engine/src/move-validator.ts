import type { GameState, PlayerColor, LegalMove, PieceId, MoveResult } from './types';
import { BoardMapper } from './board-mapper';

// Breakable walls: the hardcore mod (star shields off) AND the clash QTE, because
// a wall is beaten through the press race rather than captured outright. The
// safe-zone flag cannot carry the gate on its own : it protects only the eight
// safe squares, while a wall anywhere else still closes the path. Strict `=== true`
// keeps a state written before these rules existed (both fields absent) blocking,
// which is the standard room, and a sloppy payload (a string, a 1) from opening it.
export function wallsAreBreakable(state: GameState): boolean {
  return state.clashMode === true && state.noSafeZones === true;
}

// MoveValidator - determines legal moves, resolves captures, checks wins, and executes moves.
export class MoveValidator {
  // All legal moves for `color` given the dice roll: prison exits (6 only),
  // normal track moves with blockade checks, home entries. Used by
  // LudoEngine.rollDice to build pendingLegalMoves.
  static getLegalMoves(state: GameState, color: PlayerColor, diceValue: number): LegalMove[] {
    const moves: LegalMove[] = [];
    // One read of the breakable-wall gate for the whole list. It is passed to the
    // track site only: the prison exit below keeps the share semantics.
    const wallBreak = wallsAreBreakable(state);

    for (const piece of state.pieces.filter((p) => p.color === color)) {
      const from = piece.step;

      // Skip if exited (step < 0)
      if (from < 0) continue;

      // Skip if already finished (step === 57)
      if (from === 57) continue;

      // Prison exit rule: a piece leaves prison only on a roll of 6, and exiting
      // consumes the 6 (the piece lands on step 1; the remaining 5 steps are not
      // applied). The next roll then moves it 1-6 steps.
      // Under the free exit room rule any roll opens the prison and the roll then
      // applies FROM the star, so `to` is diceValue + 1: a 5 walks out to step 6,
      // a 6 reaches step 7 and still grants its bonus roll. Either way the exit
      // checks no blockade, so it may pass over a wall and may share the square
      // it lands on: with the star shield off a wall can be parked on a start
      // square, and an exit that respected blockades would be sealed for good
      // (see the free-exit note in todo.md).
      if (from === 0) {
        if (diceValue !== 6 && !state.freeExit) continue;
        const to = state.freeExit ? diceValue + 1 : 1;
        const isHomeEntry = false;
        // A prison exit never attacks a wall, so no wallBreak is passed here: a wall
        // on the landing square stays a share (captureCount 0) and never starts a
        // clash, which matters most under the free exit where `to` can reach one.
        const isCapture = this.isCapturableTarget(state, color, piece.id, to);
        moves.push({
          pieceId: piece.id,
          from,
          to,
          isCapture,
          isHomeEntry,
          captureCount: this.captureCountAt(state, color, piece.id, to),
        });
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
      // The gate travels as an argument: the exit branch above calls the same
      // function and must keep the old semantics.
      const isCapture = this.isCapturableTarget(state, color, piece.id, to, wallBreak);

      moves.push({
        pieceId: piece.id,
        from,
        to,
        isCapture,
        isHomeEntry,
        // 1 for a single defender, the wall's size under the gate, 0 for a plain move.
        captureCount: this.captureCountAt(state, color, piece.id, to, wallBreak),
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
    const opponentColors: PlayerColor[] = ['blue', 'red', 'green', 'yellow'].filter(
      (c) => c !== moverColor,
    ) as PlayerColor[];

    // Walk the mover's own-step path, but only main-track steps (1-51) participate.
    // When the move ends in the home stretch/goal (to > 51), still check the
    // intermediate track cells (e.g. step 51) the piece crosses before entering home.
    // With breakable walls the landing square becomes attackable but no square
    // becomes passable: the destination is excluded from the check, every square
    // before it still blocks, and a home entry keeps checking 51 (a wall on the last
    // track square still closes the way in). Hence `to <= 51 ? to - 1 : 51` rather
    // than `Math.min(to, 51) - 1`, which would open 51 to home entries.
    const lastTrackStep = wallsAreBreakable(state) ? (to <= 51 ? to - 1 : 51) : Math.min(to, 51);
    for (let step = from + 1; step <= lastTrackStep; step++) {
      const moverPos = BoardMapper.toTrackPosition(pieceId, step);
      if (moverPos === -1) continue;
      // Safe zones never form a blockade : skip them so a stack there doesn't
      // block. The hardcore mod (noSafeZones on) removes that exemption.
      if (!state.noSafeZones && BoardMapper.isSafeZoneStep(pieceId, step)) continue;
      for (const blockerColor of opponentColors) {
        if (BoardMapper.isBlockadeAtTrackPos(state.pieces, blockerColor, moverPos)) {
          return true;
        }
      }
    }
    return false;
  }

  // The one decision behind "can the mover capture on targetStep, and how big is
  // that capture?": both the legality flag and the count the bot/UI rank by come
  // from here, which is what stops a landing on a wall from being legal but not a
  // capture (the piece would share the wall instead of breaking it). Main track
  // only; safe zones are never capturable unless the hardcore rule removed them;
  // a 2+ same-colour stack is a share rather than a capture unless `wallBreak` (the
  // breakable-wall gate) says it can be attacked. 0 = nothing captured (every
  // prison exit landing on a wall included), 1 = a single defender, R = the wall's
  // size, i.e. the number of clash rounds the attack costs.
  static captureCountAt(
    state: GameState,
    moverColor: PlayerColor,
    pieceId: PieceId,
    targetStep: number,
    wallBreak = false,
  ): number {
    if (targetStep <= 0 || targetStep >= 52) return 0;

    // Safe zones (start squares + shared safe loop) never allow captures, unless
    // the room turned them off (`noSafeZones`, the hardcore mod): then every
    // square is fair game, which is what the lobby toggle advertises.
    if (!state.noSafeZones && BoardMapper.isSafeZoneStep(pieceId, targetStep)) return 0;

    const targetPos = BoardMapper.toTrackPosition(pieceId, targetStep);
    if (targetPos === -1) return 0;

    // Every opponent piece on that square (prison and home pieces map to trackPos
    // -1 and can never match), which is also what the capture would send home.
    const defenders = this.findPiecesAtPosition(state, moverColor, targetStep);
    if (defenders.length === 0) return 0;

    // Blockade rule: a 2+ same-color opponent stack on the landing square is
    // uncapturable : sharing is fine, capturing is not. The blocker pieces are
    // compared on the shared track loop via the mover's target track position.
    if (!wallBreak) {
      const opponentColors: PlayerColor[] = ['blue', 'red', 'green', 'yellow'].filter(
        (c) => c !== moverColor,
      ) as PlayerColor[];
      for (const blockerColor of opponentColors) {
        if (BoardMapper.isBlockadeAtTrackPos(state.pieces, blockerColor, targetPos)) {
          return 0;
        }
      }
    }

    return defenders.length;
  }

  // The boolean the move sites store (and the execution path relies on): defined as
  // "the capture size is not zero", never as a second copy of the same rules, so
  // the two can never disagree.
  static isCapturableTarget(
    state: GameState,
    moverColor: PlayerColor,
    pieceId: PieceId,
    targetStep: number,
    wallBreak = false,
  ): boolean {
    return this.captureCountAt(state, moverColor, pieceId, targetStep, wallBreak) > 0;
  }

  // Every opponent piece occupying the landing square : a stacked block is
  // captured as a whole. Defensive: normally one color's block at most, but
  // the whole-square rule means a rule change can't leave defenders behind.
  static findPiecesAtPosition(
    state: GameState,
    excludeColor: PlayerColor,
    targetStep: number,
  ): PieceId[] {
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

  static resolveCapture(
    state: GameState,
    capturerColor: PlayerColor,
    targetStep: number,
  ): PieceId[] {
    return this.findPiecesAtPosition(state, capturerColor, targetStep);
  }

  static checkWinner(state: GameState): PlayerColor | null {
    for (const player of state.players) {
      const playerPieces = state.pieces.filter((p) => p.color === player.color);
      if (playerPieces.every((p) => p.step === 57)) {
        return player.color;
      }
    }
    return null;
  }

  static countPiecesInGoal(state: GameState, color: PlayerColor): number {
    return state.pieces.filter((p) => p.color === color && p.step === 57).length;
  }

  // Apply a chosen legal move to the state: move the piece, send captured
  // pieces home, bump turn counts, and build the MoveResult (path, capture
  // list, bonus-roll flag). Used by LudoEngine.movePiece.
  static executeMove(state: GameState, pendingMove: LegalMove, diceValue: number): MoveResult {
    const piece = state.pieces.find((p) => p.id === pendingMove.pieceId);
    const capturerColor = piece.color;

    // Move piece
    piece.step = pendingMove.to;

    // Resolve capture : every opponent piece stacked on the landing square goes home
    let capturedPieceIds: PieceId[] = [];
    if (pendingMove.isCapture) {
      capturedPieceIds = this.resolveCapture(state, capturerColor, pendingMove.to);
      for (const id of capturedPieceIds) {
        const captured = state.pieces.find((p) => p.id === id);
        captured.step = 0;
      }
      if (capturedPieceIds.length > 0) {
        const capturer = state.players.find((p) => p.color === capturerColor);
        capturer.stats.captures += capturedPieceIds.length;
      }
    }

    // Update player turn count
    const player = state.players.find((p) => p.color === capturerColor);
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
      bonusRoll: diceValue === 6 || captured,
    };
  }
}
