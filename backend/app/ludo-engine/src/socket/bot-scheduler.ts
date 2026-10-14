import type { LudoEngine } from '../engine';
import type { RedisGameStore } from '../redis';
import type { LudoBot } from '../bot';
import { isBotSeat } from '../bot';
import type { PlayerColor } from '../types';

// BotTurnScheduler owns bot turn timing: one timer per game (never stacked),
// called only by SocketServer from engine events and bot-slot joins. A hard
// freeze also stands bots down while the clash QTE and its result card show.
export class BotTurnScheduler {
  private botTurnTimers = new Map<string, NodeJS.Timeout>();
  // While now < clashFreezeUntil[gameId] no bot turn fires. Bots act outside the
  // human input path that state.resultCardUntil gates, so they need this map.
  private clashFreezeUntil = new Map<string, number>();

  constructor(
    private store: RedisGameStore,
    private engine: LudoEngine,
    private getOrCreateBot: (
      gameId: string,
      color: PlayerColor,
      engine: LudoEngine,
      store: RedisGameStore,
    ) => LudoBot,
  ) {}

  // If the current turn belongs to a bot, run its turn after `delayMs` (lets
  // in-flight move animations finish). Serialized with human moves.
  schedule(gameId: string, delayMs: number): void {
    // Cancel an old timer for this game so we never stack overlapping bot
    // turns (safer than relying on takeTurn's phase guard alone).
    if (this.botTurnTimers.has(gameId)) {
      clearTimeout(this.botTurnTimers.get(gameId));
    }
    const timer = setTimeout(() => {
      this.botTurnTimers.delete(gameId);
      this.store
        .loadGameState(gameId)
        .then((state) => {
          if (state?.status !== 'active') return;
          // Pause-air guard: while a bot-mode game is paused, the in-flight bot
          // may finish its chain, but no further triggers run once the turn
          // moves past pauseTurnOwner.
          if (state.paused && state.currentTurn !== state.pauseTurnOwner) return;
          // Clash freeze: while the QTE or its result card is up, bots stand down.
          const freezeUntil = this.clashFreezeUntil.get(gameId);
          if (freezeUntil && Date.now() < freezeUntil) return;
          // Bot detection reads the persisted seat, so a restarted engine (its
          // in-memory seat map empty) still drives the bot's turn.
          if (!isBotSeat(state, state.currentTurn)) return;

          const bot = this.getOrCreateBot(gameId, state.currentTurn, this.engine, this.store);
          // takeTurn() catches its own failures, but this is fire-and-forget :
          // a rejection here would crash the whole engine process, not just
          // this game. Belt-and-suspenders.
          bot.takeTurn().catch((err) => {
            console.error(
              `[bot] unexpected takeTurn rejection for game ${gameId}:`,
              err instanceof Error ? err.message : err,
            );
          });
          // Bonus roll / capture chains emit piece_moved -> engine event -> schedule again
        })
        .catch((err) => {
          console.error(
            `[bot] failed to load game state for ${gameId}:`,
            err instanceof Error ? err.message : err,
          );
        });
    }, delayMs);
    this.botTurnTimers.set(gameId, timer);
  }

  // Freeze bots for a game until `untilMs` (the clash QTE, then its result card).
  setClashFreeze(gameId: string, untilMs: number): void {
    this.clashFreezeUntil.set(gameId, untilMs);
  }

  // Drop this game's bot-turn state (pending timers + clash freeze).
  clear(gameId: string): void {
    const timer = this.botTurnTimers.get(gameId);
    if (timer) clearTimeout(timer);
    this.botTurnTimers.delete(gameId);
    this.clashFreezeUntil.delete(gameId);
  }
}
