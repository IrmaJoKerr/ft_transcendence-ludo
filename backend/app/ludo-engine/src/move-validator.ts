import type { GameState, PlayerColor, LegalMove, PieceId, MoveResult } from './types';
import { BoardMapper } from './board-mapper';
import { orderDefenderIds } from './clash';

// A protected star square: the shield is on and this step is one of the eight safe
// tracks. Its barriers neither block nor can be attacked, which is the default and
// why a wall on a start square does not matter in such a room.
function isProtectedStar(state: GameState, pieceId: PieceId, step: number): boolean {
  return state.noSafeZones !== true && BoardMapper.isSafeZoneStep(pieceId, step);
}

// The mover's token hand. Clash mode grants the chance to break a wall, the arm
// switch takes it and the token pays for it, so an empty hand has no wall options.
// Strict reads keep a state written before the field existed at 0.
function seatHoldsToken(state: GameState, pieceId: PieceId): boolean {
  const { color } = BoardMapper.parsePieceId(pieceId);
  return (state.players?.find((p) => p.color === color)?.barrierTokens ?? 0) > 0;
}

// Breakable walls, per square: clash mode plus a token in hand opens a wall, and a star
// square keeps its shield unless hardcore removed it. The list is the same armed or not;
// the client hides priced moves until the player arms.
export function wallIsAttackable(state: GameState, pieceId: PieceId, step: number): boolean {
  return (
    state.clashMode === true &&
    seatHoldsToken(state, pieceId) &&
    !isProtectedStar(state, pieceId, step)
  );
}

// MoveValidator - determines legal moves, resolves captures, checks wins, and executes moves.
export class MoveValidator {
  // All legal moves for `color` given the roll: prison exits, track moves with
  // blockade checks, home entries. Used by LudoEngine.rollDice to build
  // pendingLegalMoves.
  static getLegalMoves(state: GameState, color: PlayerColor, diceValue: number): LegalMove[] {
    const moves: LegalMove[] = [];

    for (const piece of state.pieces.filter((p) => p.color === color)) {
      const from = piece.step;

      // Skip if exited (step < 0)
      if (from < 0) continue;

      // Skip if already finished (step === 57)
      if (from === 57) continue;

      // Landing rule: a move fights only the square it lands on; passing squares are
      // untouched. A prison exit is an ordinary move from step 0, so a wall on step k
      // is attacked only by a move that lands on k.
      if (from === 0) {
        if (diceValue === 6 || state.freeExit === true) {
          const to = state.freeExit ? diceValue : 1;
          if (!this.blockadeBlocksPath(state, color, from, to, piece.id)) {
            const wallBreak = wallIsAttackable(state, piece.id, to);
            const captureCount = this.captureCountAt(state, color, piece.id, to, wallBreak);
            moves.push({
              pieceId: piece.id,
              from,
              to,
              isCapture: captureCount > 0,
              isHomeEntry: false,
              captureCount,
              // The exit lands where the roll lands, so a wall on that square is
              // attacked by the same rule and costs the same token.
              spendsBarrierToken: this.landingPaysToken(state, color, to, captureCount),
            });
            // A piece with a plain exit needs no rescue: the armed variant below
            // would only repeat the same roll, so an exit is offered at most once
            // per piece (and never twice on the same (pieceId, to)).
            continue;
          }
        }
        const armed = this.armedExit(state, color, piece.id, diceValue);
        if (armed) moves.push(armed);
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
      // The gate is read for THIS destination, not for the board: a wall on an
      // ordinary square is attackable while this seat is armed, a wall on a
      // protected star stays a share, and an unarmed seat is blocked by the wall.
      const wallBreak = wallIsAttackable(state, piece.id, to);
      // 1 for a single defender, the wall's size under the gate, 0 for a plain move.
      const captureCount = this.captureCountAt(state, color, piece.id, to, wallBreak);
      const isCapture = captureCount > 0;

      moves.push({
        pieceId: piece.id,
        from,
        to,
        isCapture,
        isHomeEntry,
        captureCount,
        // A landing on a wall is the token's price, wherever the move came from.
        spendsBarrierToken: this.landingPaysToken(state, color, to, captureCount),
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
    // Moves that never touch the main track cannot be blocked. A prison exit is
    // checked from step 1 on, since a wall on the landing square is the destination
    // case, not a crossing.
    if (from < 0 || to < 1) return false;

    // Opponents' blockades only matter; own pieces never physically block the mover.
    const opponentColors: PlayerColor[] = ['blue', 'red', 'green', 'yellow'].filter(
      (c) => c !== moverColor,
    ) as PlayerColor[];

    // Walk the mover's own-step path, main-track steps only. When the move ends in the
    // home stretch, still check the track cells it crosses. The destination is exempt
    // only when a wall there is attackable; every square before it still blocks.
    const lastTrackStep =
      to <= 51 && wallIsAttackable(state, pieceId, to) ? to - 1 : Math.min(to, 51);
    for (let step = from + 1; step <= lastTrackStep; step++) {
      const moverPos = BoardMapper.toTrackPosition(pieceId, step);
      if (moverPos === -1) continue;
      // Safe zones never form a blockade : skip them so a stack there doesn't
      // block. The hardcore mod (noSafeZones on) removes that exemption.
      if (isProtectedStar(state, pieceId, step)) continue;
      for (const blockerColor of opponentColors) {
        if (BoardMapper.isBlockadeAtTrackPos(state.pieces, blockerColor, moverPos)) {
          return true;
        }
      }
    }
    return false;
  }

  // The opponent pieces standing on one step of the mover's OWN track, in the
  // order a chain fights them (ascending piece id, so the same board always fights
  // the same order however `state.pieces` happens to be ordered).
  private static squareDefenders(
    state: GameState,
    moverColor: PlayerColor,
    step: number,
  ): PieceId[] {
    return orderDefenderIds(this.findPiecesAtPosition(state, moverColor, step));
  }

  // True when the pieces on one square form a barrier: 2+ of the SAME opponent
  // colour. A pair of different colours is not a barrier, it is a normal
  // two-defender landing (the same reading `isBlockadeAtTrackPos` uses).
  private static isBarrier(pieces: PieceId[]): boolean {
    const byColor = new Map<PlayerColor, number>();
    for (const id of pieces) {
      const color = BoardMapper.parsePieceId(id).color;
      byColor.set(color, (byColor.get(color) ?? 0) + 1);
    }
    return [...byColor.values()].some((n) => n >= 2);
  }

  // The token price of a landing: attacking a wall (2+ defenders of one colour, the
  // reading armedExit uses) costs one token, whatever square the move came from. A
  // lone defender or a mixed pair is free.
  private static landingPaysToken(
    state: GameState,
    color: PlayerColor,
    step: number,
    captureCount: number,
  ): boolean {
    return captureCount >= 2 && this.isBarrier(this.squareDefenders(state, color, step));
  }

  // The armed exit: with clash mode and a token, a piece in prison may land on the
  // barrier the roll reaches exactly. The token buys a landing, never a crossing, so
  // the wall must stand `diceValue` squares out.
  private static armedExit(
    state: GameState,
    color: PlayerColor,
    pieceId: PieceId,
    diceValue: number,
  ): LegalMove | null {
    const to = diceValue;
    if (state.clashMode !== true || to < 1 || to > 51) return null;
    const mover = state.players.find((p) => p.color === color);
    if ((mover?.barrierTokens ?? 0) <= 0) return null;

    // The bust lands ON the wall it fights: a lone defender (or a mixed pair) is
    // no barrier, and the ordinary exit rules above already cover it.
    if (!this.isBarrier(this.squareDefenders(state, color, to))) return null;
    // A protected star is never attacked. This must be read here, not left to the
    // path check: a star never blocks, so `blockadeBlocksPath` would pass it and
    // the bust would land on a wall it cannot fight.
    if (!wallIsAttackable(state, pieceId, to)) return null;
    // Everything behind the landing, under the same rule every other move reads:
    // this is what forbids a second barrier on the way and what makes the roll's
    // distance exact.
    if (this.blockadeBlocksPath(state, color, 0, to, pieceId)) return null;

    return {
      pieceId,
      from: 0,
      to,
      isCapture: true,
      isHomeEntry: false,
      // The whole barrier: one clash round per defender.
      captureCount: this.captureCountAt(state, color, pieceId, to, true),
      spendsBarrierToken: true,
    };
  }

  // The one decision behind "can the mover capture on targetStep, and how big is that
  // capture?": both the legality flag and the count the bot ranks by come from here.
  // 0 = nothing, 1 = one defender, R = the wall size in clash rounds.
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
