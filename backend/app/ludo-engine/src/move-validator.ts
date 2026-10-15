import type { GameState, PlayerColor, LegalMove, PieceId, MoveResult, BattlePlan } from './types';
import { BoardMapper } from './board-mapper';
import { orderDefenderIds } from './clash';

// A protected star square: the shield is on and this step is one of the eight
// safe tracks. Its barriers neither block the path nor can be attacked, which is
// the game's existing default and why a wall parked on a start square is a
// non-issue in such a room.
function isProtectedStar(state: GameState, pieceId: PieceId, step: number): boolean {
  return state.noSafeZones !== true && BoardMapper.isSafeZoneStep(pieceId, step);
}

// Breakable walls, PER SQUARE: clash mode opens a wall, and a star square keeps
// its shield unless the hardcore mod removed it, so the gate reads
// `clashMode && (noSafeZones || !isStarSquare)`. Clash mode ALONE opens a wall on
// an ordinary square: the old board-wide form demanded clash AND `noSafeZones`
// together everywhere, which left a clash-only room unable to attack a wall at
// all. Strict `=== true` reads keep a state written before these rules existed
// (both fields absent) blocking, which is the standard room, and a sloppy payload
// (a string, a 1) from opening it.
export function wallIsAttackable(state: GameState, pieceId: PieceId, step: number): boolean {
  return state.clashMode === true && !isProtectedStar(state, pieceId, step);
}

// MoveValidator - determines legal moves, resolves captures, checks wins, and executes moves.
export class MoveValidator {
  // All legal moves for `color` given the dice roll: prison exits (a 6, or any
  // roll under the free exit, plus the armed Barrier Buster exit), normal track
  // moves with blockade checks, home entries. Used by LudoEngine.rollDice to
  // build pendingLegalMoves.
  static getLegalMoves(state: GameState, color: PlayerColor, diceValue: number): LegalMove[] {
    const moves: LegalMove[] = [];

    for (const piece of state.pieces.filter((p) => p.color === color)) {
      const from = piece.step;

      // Skip if exited (step < 0)
      if (from < 0) continue;

      // Skip if already finished (step === 57)
      if (from === 57) continue;

      // Prison exit rule: a piece leaves prison on a 6, and that 6 lands it on
      // step 1 (the remaining 5 steps are not applied). Under the free exit room
      // rule any roll opens the prison and the first step out counts as part of
      // the roll, so `to` is diceValue itself: a 5 walks out to step 5, a 6 to
      // step 6 and still grants its bonus roll. Either way the exit is an
      // ORDINARY move from step 0: it fights only the square it LANDS on, and a
      // barrier it would have to cross blocks it exactly as it blocks any other
      // move, so the door fight needs an exact roll (a 1 with the free exit on,
      // a 6 with it off) — the wall on step k is attacked only by a move that
      // lands on k. A barrier parked on a protected star is neither fought nor
      // blocking: the exit passes it and shares the landing.
      if (from === 0) {
        if (diceValue === 6 || state.freeExit === true) {
          const to = state.freeExit ? diceValue : 1;
          if (!this.blockadeBlocksPath(state, color, from, to, piece.id)) {
            const wallBreak = wallIsAttackable(state, piece.id, to);
            moves.push({
              pieceId: piece.id,
              from,
              to,
              isCapture: this.isCapturableTarget(state, color, piece.id, to, wallBreak),
              isHomeEntry: false,
              captureCount: this.captureCountAt(state, color, piece.id, to, wallBreak),
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
      // ordinary square is attackable in a clash-only room, while a wall on a
      // protected star stays a share.
      const wallBreak = wallIsAttackable(state, piece.id, to);
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
    // Moves that never touch the main track can't be blocked. A prison exit is
    // `from` 0 (an exited piece is negative and never moves), so it is checked
    // from step 1 on: a wall on the square an exit LANDS on is the destination
    // case below, not a crossing.
    if (from < 0 || to < 1) return false;

    // Opponents' blockades only matter; own pieces never physically block the mover.
    const opponentColors: PlayerColor[] = ['blue', 'red', 'green', 'yellow'].filter(
      (c) => c !== moverColor,
    ) as PlayerColor[];

    // Walk the mover's own-step path, but only main-track steps (1-51) participate.
    // When the move ends in the home stretch/goal (to > 51), still check the
    // intermediate track cells (e.g. step 51) the piece crosses before entering home.
    // The destination is exempt from the walk only when a wall THERE is attackable
    // (that landing is a fight, not a block); otherwise landing on a barrier is
    // blocked like crossing it. No square becomes passable: every square before the
    // destination still blocks, and a home entry keeps checking 51 (a wall on the
    // last track square still closes the way in). Hence `to - 1` rather than
    // `Math.min(to, 51) - 1`, which would open 51 to home entries.
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

  // The armed exit (a Barrier Buster token): with clash mode on and a token in
  // hand, a piece still in prison may leave on ANY roll — the token waives the
  // exit-roll gate, which is what rescues a seat sealed in by a 6 drought — and
  // the walk crosses a barrier the ordinary rules refuse to cross. It is offered
  // only when the plain exit is NOT legal (see getLegalMoves), so a piece never
  // carries two exits to the same square.
  //
  // The walk is steps 1..to with `to` = the roll: it crosses the barrier instead
  // of being stopped by it, and finishes on `to` like any other move. One token
  // fights AT MOST ONE barrier — a walk that meets two (the double-stacked
  // corridor) has no armed variant at all, which keeps "one credit, one barrier"
  // literal. A barrier on a protected star is never attacked: the walk passes it,
  // exactly as the free exit does. The battles come back in path order (the
  // crossed barrier first, then the landing square's own defenders), and
  // `captureCount` is their total, i.e. the clash rounds the move costs.
  private static armedExit(
    state: GameState,
    color: PlayerColor,
    pieceId: PieceId,
    to: number,
  ): LegalMove | null {
    if (state.clashMode !== true || to < 1 || to > 51) return null;
    const mover = state.players.find((p) => p.color === color);
    if ((mover?.barrierTokens ?? 0) <= 0) return null;

    const fights: BattlePlan[] = [];
    let barriers = 0;
    for (let step = 1; step <= to; step++) {
      const onSquare = this.squareDefenders(state, color, step);
      if (onSquare.length === 0) continue;

      if (this.isBarrier(onSquare)) {
        if (isProtectedStar(state, pieceId, step)) continue;
        barriers++;
        if (barriers > 1) return null;
        fights.push({ step, defenderIds: onSquare });
        continue;
      }

      // Not a barrier: it only matters when it is the square the walk stops on.
      if (step !== to) continue;
      if (!this.isCapturableTarget(state, color, pieceId, step)) continue;
      fights.push({ step, defenderIds: onSquare });
    }

    return {
      pieceId,
      from: 0,
      to,
      isCapture: fights.length > 0,
      isHomeEntry: false,
      captureCount: fights.reduce((n, b) => n + b.defenderIds.length, 0),
      spendsBarrierToken: true,
      // Only a walk that fights somewhere carries an explicit battle list: a walk
      // with nothing to fight spends its token for the roll alone.
      ...(fights.length > 0 ? { fights } : {}),
    };
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
