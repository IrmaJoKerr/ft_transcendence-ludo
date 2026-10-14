import type { LudoEngine } from './engine';
import type { RedisGameStore } from './redis';
import { BoardMapper } from './board-mapper';
import { MoveValidator } from './move-validator';
import { CLASH_BOT_VS_BOT_WIN_CHANCE, CLASH_BOT_VS_HUMAN_WIN_CHANCE } from './clash';
import { BOT_PREFIX } from './socket/auth';
import type { PlayerColor, GameState, LegalMove } from './types';

const botMap = new Map<string, Map<PlayerColor, LudoBot>>();

// Get/create the bot instance for one seat in one game.
// Used by socket/server.ts whenever a bot's turn must be triggered.
export function getOrCreateBot(
  gameId: string,
  color: PlayerColor,
  engine: LudoEngine,
  store: RedisGameStore,
): LudoBot {
  if (!botMap.has(gameId)) botMap.set(gameId, new Map());
  const gameBots = botMap.get(gameId);
  if (!gameBots.has(color)) {
    gameBots.set(color, new LudoBot(gameId, color, engine, store));
  }
  return gameBots.get(color);
}

// Is this seat a bot? Read from the persisted state, never from the in-memory
// seat map: the map is empty after a restart, and gating bot turns on it is what
// froze every bot game (todo P1: engine restart recovery). `isBot` is the
// authoritative flag; the `bot-<color>` username keeps pre-flag states readable.
export function isBotSeat(state: GameState | null | undefined, color: PlayerColor): boolean {
  const player = state?.players.find((p) => p.color === color);
  if (!player) return false;
  return player.isBot === true || player.username?.startsWith(BOT_PREFIX) === true;
}

// Move-selection scale. No positional score reaches 1560 (a home entry: 1000 +
// 10 x 56), and a capture's credit is CAPTURE_CREDIT discounted by its clash odds
// (see captureOdds), which keeps every old decision in place and adds the chain
// rule: with no QTE standing in the way the credit is the full 7000, a lone
// defender is still taken against a human (7000 x 0.25 = 1750) or a bot (3500),
// while a wall of 2 or more falls below the positional moves (7000 x 0.25 ** 2 =
// 437): a chain the bot probably loses is not worth walking into.
const CAPTURE_CREDIT = 7000;
// On a roll of 6 freeing a piece from jail is the tempo play the old priority
// list took before any scoring. The bonus keeps that order: a jail exit with
// every other bonus (100 + 10 x 7 + 500 = 670) plus this lands at 1670, above the
// best positional move (1560) and below the cheapest capture the bot takes (1750).
const JAIL_EXIT_BONUS = 1000;

// Server-side Ludo Bot with heuristic move selection. One instance per
// (game, color); turn scheduling is owned by SocketServer, not the bot.
export class LudoBot {
  // The engine this bot plays through (roll/move calls).
  private engine: LudoEngine;
  private store: RedisGameStore;
  private gameId: string;
  private color: PlayerColor;

  constructor(gameId: string, color: PlayerColor, engine: LudoEngine, store: RedisGameStore) {
    this.gameId = gameId;
    this.color = color;
    this.engine = engine;
    this.store = store;
  }

  // Select the best move on one scale, captures included: a capture's credit
  // carries the odds the bot wins its clash (see captureOdds), so a chain it
  // expects to lose ranks below a safe alternative instead of being taken on
  // sight. A rank, never a filter, because a null here spends the dice and stalls
  // the turn (see takeTurnUnsafe): a wall attack with nothing else to play still
  // comes back as the best move.
  selectBestMove(legalMoves: LegalMove[], state: GameState, diceValue: number): LegalMove | null {
    if (legalMoves.length === 0) return null;
    if (legalMoves.length === 1) return legalMoves[0];

    const scored = legalMoves.map((move) => ({
      move,
      score: this.scoreMove(move, state, diceValue),
    }));

    // Array.prototype.sort is stable, so equal scores keep the validator's order
    // (the tie-break the old `captures[0]` return used: pool captures, then the
    // furthest along).
    scored.sort((a, b) => b.score - a.score);
    return scored[0].move;
  }

  // Score a move on one scale. Higher score = better move.
  private scoreMove(move: LegalMove, state: GameState, diceValue: number): number {
    // A capture is worth what it is likely to win, and carries no positional bonus
    // on top: the credit already dwarfs them, and adding progress back would undo
    // the chain discount (a 4 deep wall against a human is worth 219, while plain
    // progress alone pays up to 570).
    if (move.isCapture) {
      return CAPTURE_CREDIT * this.captureOdds(state, move);
    }

    let score = 0;

    // Home entry is excellent
    if (move.isHomeEntry) {
      score += 1000;
    }

    // Safe zone bonus
    if (BoardMapper.isSafeZoneStep(move.pieceId, move.to)) {
      score += 500;
    }

    // Progress bonus (scaled)
    score += move.to * 10;

    // Moving from jail has slight bonus, and on a 6 it is the priority play
    if (move.from === 0) {
      score += 100;
      if (diceValue === 6) {
        score += JAIL_EXIT_BONUS;
      }
    }

    return score;
  }

  // Odds the bot takes the landing square. With no QTE standing between the move
  // and the capture (clash mode off, so the capture just applies) they are
  // certain. Under clash mode each round's winner is drawn independently and
  // pre-rolled against the same constants the bot pressers use, so a landing that
  // costs one round is `p` and a wall of R defenders, one round each, is `p ** R`.
  // The defender's seat picks p: another bot is a coin flip, a human beats this
  // bot three times out of four.
  private captureOdds(state: GameState, move: LegalMove): number {
    if (!state.clashMode) return 1;
    // The defenders' colour comes from the landing square through the same helper
    // the validator counts a wall with, so the two can never disagree.
    const defenders = MoveValidator.findPiecesAtPosition(state, this.color, move.to);
    const defenderColor = defenders.length > 0 ? BoardMapper.parsePieceId(defenders[0]).color : null;
    const perRound =
      defenderColor && isBotSeat(state, defenderColor)
        ? CLASH_BOT_VS_BOT_WIN_CHANCE
        : CLASH_BOT_VS_HUMAN_WIN_CHANCE;
    // A capture always has at least one defender; the `> 0` guard is for a move
    // list written before `captureCount` existed, where the field is undefined.
    const rounds = move.captureCount > 0 ? move.captureCount : 1;
    return perRound ** rounds;
  }

  // Execute bot turn: roll dice, make the best move. Does NOT schedule
  // follow-up turns (SocketServer owns that). Returns true if still active.
  async takeTurn(): Promise<boolean> {
    try {
      return await this.takeTurnUnsafe();
    } catch (err) {
      // Engine calls throw when the game ended or the turn moved on during the gaps
      // between our state checks: a normal race, not a bug. Swallow it, because the
      // caller does not await this promise and an unhandled rejection ends the process.
      console.error(
        `[bot] takeTurn aborted for game ${this.gameId} (${this.color}):`,
        err instanceof Error ? err.message : err,
      );
      return false;
    }
  }

  private async takeTurnUnsafe(): Promise<boolean> {
    // Strict turn validation : mirrors socket-handlers.ts early validation for humans
    const state = await this.store.loadGameState(this.gameId);
    if (state?.status !== 'active') return false;
    if (state.currentTurn !== this.color) return false; // Not our turn
    if (state.turnPhase !== 'WAITING_FOR_ROLL') return false; // Wrong phase

    // Roll dice : engine validates currentTurn again
    const { value: diceValue, legalMoves } = await this.engine.rollDice(this.gameId);

    if (legalMoves.length > 0) {
      // Re-validate after roll: turn may have changed due to disconnect
      const afterRoll = await this.store.loadGameState(this.gameId);
      if (afterRoll?.currentTurn !== this.color) return false;

      // Select best move using heuristics
      const bestMove = this.selectBestMove(legalMoves, afterRoll, diceValue);
      if (!bestMove) return false;

      // Delay piece movement so frontend dice roll animation finishes first and displays the number
      await new Promise((resolve) => setTimeout(resolve, 1200));

      // Re-validate once more: the game can end or the turn can move on
      // during the delay above (e.g. the other player times out).
      const beforeMove = await this.store.loadGameState(this.gameId);
      if (beforeMove?.status !== 'active' || beforeMove.currentTurn !== this.color) return false;

      // Execute move : engine emits piece_moved and game_ended events via handleEngineEvent
      const { state: finalState } = await this.engine.movePiece(this.gameId, bestMove.pieceId);

      // Check for win after bot move
      if (finalState.status === 'finished') {
        return false; // Game finished
      }
    }

    return true; // Game still active
  }
}
