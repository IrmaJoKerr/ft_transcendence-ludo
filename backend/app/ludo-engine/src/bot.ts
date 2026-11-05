import type { LudoEngine } from './engine';
import type { RedisGameStore } from './redis';
import { BoardMapper } from './board-mapper';
import { WALL_BREAKER_TOKEN_CAP } from './__shared__/wall-breaker.constants';
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

// Bot seat check. Read `isBot` from the persisted state, not the in-memory seat
// map: the map is empty after a restart. That flag is the only answer: a seat
// whose id or name starts with `bot-` is still a human seat if it is not
// flagged, so nothing infers the kind from a string.
// See docs/ludo-engine/ludo-engine-bot-module.md.
export function isBotSeat(state: GameState | null | undefined, color: PlayerColor): boolean {
  const player = state?.players.find((p) => p.color === color);
  return player?.isBot === true;
}

// Move-selection scale: no positional move scores above 1560 and a free capture
// is worth CAPTURE_CREDIT. A token-priced wall break pays the seat's appetite
// instead: `BOT_WALL_BREAK_VALUE x pct / 100`, an exact integer because the base
// is a multiple of 100. The bot doc and the Constant list carry the worked values.
const CAPTURE_CREDIT = 7000;
// What one Wall Breaker token is worth to the decision, before the seat's
// appetite is applied. 2000 keeps the one-token credit (600) just above the 570
// a plain advance tops out at, so a seat with its last token still breaks a wall
// rather than shuffling forward.
export const BOT_WALL_BREAK_VALUE = 2000;
// Baseline appetite per token band, before the seat's signed 0-5 modifier: the
// last token, the reserve, and the surplus. Only the last band is a tilt: at the
// cap a fourth token has no future value, so the top band is the reserve plus a
// flat uplift (78 = 60 + 18, which is 1560 at a 2000 base: home entry, exactly,
// so the tie rule keeps the token in hand).
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

  // Rank every legal move on the one scale. Never null while a move exists: a
  // seat that has something legal to play always plays the best of it, even when
  // that move spends its last token. That guarantee is what removes the old
  // `null` plus `skipArmedWallBreak` path, which passed turns the bot was allowed
  // to take. Ties resolve in a total order: no token spent, then further along,
  // then the lower piece index.
  selectBestMove(legalMoves: LegalMove[], state: GameState, diceValue: number): LegalMove | null {
    if (legalMoves.length === 0) return null;

    const scored = legalMoves.map((move) => ({
      move,
      score: this.scoreMove(move, state, diceValue),
    }));

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // An exact tie keeps the token: it is the scarce resource this pricing
      // exists to protect, and the conservative arm cannot read as a bug. The
      // 78% cap lands exactly on a home entry (1560), so this is the rule that
      // resolves the one deliberate tie in the ladder.
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
    // A capture takes its square, so it pays no positional bonus. What it pays
    // depends on what it costs: a landing that spends a Wall Breaker token is
    // worth the seat's appetite, and a free capture (a lone defender, a mixed
    // pair, or any capture in a room without clash mode) keeps the flat credit.
    // Free captures outbid every wall break at every appetite, which is the
    // reading that a bot never spends a token when the capture costs nothing.
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

  // The seat's appetite for the hand it is holding: 30% at the last token, the
  // reserve below the cap, and the reserve plus the surplus uplift at the cap. The
  // cap is `WALL_BREAKER_TOKEN_CAP` from the shared constants, so the band cannot
  // drift from the token economy the client draws. The four seat fields are rolled
  // once when the bot seat is created, so the same game behaves the same way twice
  // and no RNG runs in the decision path. An absent profile falls back to the
  // baselines, which is why no state written before the fields existed needs a
  // migration.
  private appetite(state: GameState): number {
    const seat = state.players.find((p) => p.color === this.color);
    const tokens = seat?.wallBreakerTokens ?? 0;
    const reserve = seat?.botRiskReserve ?? BOT_RISK_RESERVE;
    if (tokens >= WALL_BREAKER_TOKEN_CAP) return reserve + BOT_SURPLUS_UPLIFT;
    if (tokens >= 2) return reserve;
    return seat?.botRiskLastToken ?? BOT_RISK_LAST_TOKEN;
  }

  // What a wall break is worth to this seat, on the same scale as every
  // positional move: the base times its stored percentage, divided by 100. Both
  // factors are integers and the base is a multiple of 100, so the comparison
  // never involves a float and a tie is a tie.
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
