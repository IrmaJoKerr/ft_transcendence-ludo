import type { LudoEngine } from './engine';
import type { RedisGameStore } from './redis';
import { BoardMapper } from './board-mapper';
import { WALL_BREAKER_TOKEN_CAP } from './__shared__/clash.constants';
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

// Read `isBot` from persisted state, not the in-memory map, which is empty after a
// restart. The flag is the only answer; a `bot-` prefix never decides the kind.
export function isBotSeat(state: GameState | null | undefined, color: PlayerColor): boolean {
  const player = state?.players.find((p) => p.color === color);
  return player?.isBot === true;
}

// One scale for every move: positional moves top out at 1560, a free capture pays
// `CAPTURE_CREDIT`, and a priced wall break pays `BOT_WALL_BREAK_VALUE x appetite / 100`.
const CAPTURE_CREDIT = 7000;
// Base value of one Wall Breaker token before appetite. It keeps the last-token
// credit above a plain advance, so a seat with one token still breaks a wall.
export const BOT_WALL_BREAK_VALUE = 2000;
// Baseline appetite per token band: last token, reserve, and surplus. The cap band adds
// a flat uplift so a fourth token is valued as a home entry and the tie rule keeps it.
export const BOT_RISK_LAST_TOKEN = 30;
export const BOT_RISK_RESERVE = 60;
export const BOT_SURPLUS_UPLIFT = 18;
// A jail exit on a 6 keeps the old tempo priority: with every other bonus it
// scores 1670, above the best positional move and above the cheapest wall break.
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

  // Rank every legal move on the one scale and never return null while a move exists.
  // Ties resolve by no token spent, then further along, then lower piece index.
  selectBestMove(legalMoves: LegalMove[], state: GameState, diceValue: number): LegalMove | null {
    if (legalMoves.length === 0) return null;

    const scored = legalMoves.map((move) => ({
      move,
      score: this.scoreMove(move, state, diceValue),
    }));

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // An exact tie keeps the token, the scarce resource this pricing protects.
      const spendA = a.move.spendsWallBreakerToken ? 1 : 0;
      const spendB = b.move.spendsWallBreakerToken ? 1 : 0;
      if (spendA !== spendB) return spendA - spendB;
      if (b.move.to !== a.move.to) return b.move.to - a.move.to;
      return (
        BoardMapper.parsePieceId(a.move.pieceId).index -
        BoardMapper.parsePieceId(b.move.pieceId).index
      );
    });
    return scored[0].move;
  }

  // Score a move on one scale. Higher score = better move.
  private scoreMove(move: LegalMove, state: GameState, diceValue: number): number {
    // A capture pays no positional bonus. A token-priced landing pays the seat's
    // appetite; a free capture keeps the flat credit, which always outbids a wall break.
    if (move.isCapture) {
      return move.spendsWallBreakerToken ? this.wallBreakCredit(state) : CAPTURE_CREDIT;
    }

    let score = 0;

    // Home entry is excellent
    if (move.isHomeEntry) {
      score += 1000;
    }

    // Safe zone bonus: only for a move that enters one on the track. A prison exit
    // lands on the occupied start square, so it gets no bonus here or from the
    // validator.
    if (move.from > 0 && BoardMapper.isSafeZoneStep(move.pieceId, move.to)) {
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

  // Appetite by token band: last token, reserve, or cap. The fields are rolled once
  // at seat creation, so decisions are deterministic; absent values use the baselines.
  private appetite(state: GameState): number {
    const seat = state.players.find((p) => p.color === this.color);
    const tokens = seat?.wallBreakerTokens ?? 0;
    const reserve = seat?.botRiskReserve ?? BOT_RISK_RESERVE;
    if (tokens >= WALL_BREAKER_TOKEN_CAP) return reserve + BOT_SURPLUS_UPLIFT;
    if (tokens >= 2) return reserve;
    return seat?.botRiskLastToken ?? BOT_RISK_LAST_TOKEN;
  }

  // Wall-break value on the same scale as a positional move. Integer factors keep the
  // comparison exact, so an equal score is a true tie.
  private wallBreakCredit(state: GameState): number {
    return (BOT_WALL_BREAK_VALUE * this.appetite(state)) / 100;
  }

  // Execute bot turn: roll dice, make the best move. Does NOT schedule
  // follow-up turns (SocketServer owns that). Returns true if still active.
  async takeTurn(): Promise<boolean> {
    try {
      return await this.takeTurnUnsafe();
    } catch (err) {
      // Engine calls throw when the game ended or the turn moved on during the gaps
      // between our state checks: a normal race, not a bug. Ignore it, because the
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

    // The bot arms whenever it holds a token: an unarmed seat is blocked by a wall,
    // so it would never see the wall landings its pricing exists for. Arming costs
    // nothing, and the appetite decides whether a priced landing is worth taking.
    const botSeat = state.players.find((p) => p.color === this.color);
    if (
      state.clashMode === true &&
      (botSeat?.wallBreakerTokens ?? 0) > 0 &&
      botSeat?.wallBreakerArmed !== true
    ) {
      await this.engine.setWallBreakerArmed(this.gameId, this.color, true);
    }

    // Roll dice : engine validates currentTurn again
    const { value: diceValue, legalMoves } = await this.engine.rollDice(this.gameId);

    if (legalMoves.length > 0) {
      // Re-validate after roll: turn may have changed due to disconnect
      const afterRoll = await this.store.loadGameState(this.gameId);
      if (afterRoll?.currentTurn !== this.color) return false;

      // Select the best move by heuristic. With a legal move on the board this is
      // never null: the bot plays on, even when the best move spends its last
      // token. The `?? legalMoves[0]` is the belt to that brace, so a comparator
      // bug can cost the bot a good move but never a turn.
      const bestMove = this.selectBestMove(legalMoves, afterRoll, diceValue) ?? legalMoves[0];

      // Delay piece movement so frontend dice roll animation finishes first and displays the number
      await new Promise((resolve) => setTimeout(resolve, 1200));

      // Re-validate once more: the game can end or the turn can move on
      // during the delay above (e.g. the other player times out).
      const beforeMove = await this.store.loadGameState(this.gameId);
      if (beforeMove?.status !== 'active' || beforeMove.currentTurn !== this.color) return false;

      // Execute move : engine emits piece_moved and game_ended events via handleEngineEvent.
      // The landing square rides along, so a caller that already knows its move
      // names it and the engine picks that exact entry.
      const { state: finalState } = await this.engine.movePiece(
        this.gameId,
        bestMove.pieceId,
        bestMove.to,
      );

      // Check for win after bot move
      if (finalState.status === 'finished') {
        return false; // Game finished
      }
    }

    return true; // Game still active
  }
}
