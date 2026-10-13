import type { LudoEngine } from './engine';
import type { RedisGameStore } from './redis';
import { BoardMapper } from './board-mapper';
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

  // Select the best move by heuristic priority: capture > free from jail
  // (on 6) > home entry > safe zone > max progress.
  selectBestMove(legalMoves: LegalMove[], state: GameState, diceValue: number): LegalMove | null {
    if (legalMoves.length === 0) return null;
    if (legalMoves.length === 1) return legalMoves[0];

    // Priority 1: Capture moves - always take them
    const captures = legalMoves.filter((m) => m.isCapture);
    if (captures.length > 0) {
      return captures[0];
    }

    // Priority 2: On a 6, prefer freeing pieces from jail (step 0)
    if (diceValue === 6) {
      const freesFromJail = legalMoves.filter((m) => m.from === 0);
      if (freesFromJail.length > 0) {
        return freesFromJail[0];
      }
    }

    // Priority 3-5: Score remaining moves
    const scored = legalMoves.map((move) => ({
      move,
      score: this.scoreMove(move),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored[0].move;
  }

  // Score a move based on heuristics.
  // Higher score = better move.
  private scoreMove(move: LegalMove): number {
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

    // Moving from jail has slight bonus
    if (move.from === 0) {
      score += 100;
    }

    return score;
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
