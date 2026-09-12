import { LudoEngine } from '../engine';
import { RedisGameStore } from '../redis';
import { LudoBot, isBotPlayer } from '../bot';
import type { PlayerColor } from '../types';

// BotTurnScheduler owns bot turn timing: one timer per game (never stacked),
// called only by SocketServer from engine events and bot-slot joins.
export class BotTurnScheduler {
  private botTurnTimers = new Map<string, NodeJS.Timeout>();
  // Hard freeze: while now < clashFreezeUntil[gameId], NO bot turns fire
  // (the clash QTE or its 3s result card is showing). Human turns are
  // unaffected — they are rejected server-side by the engine's guards.
  private clashFreezeUntil = new Map<string, number>();

  constructor(
    private store: RedisGameStore,
    private engine: LudoEngine,
    private userIdMap: Map<string, Map<PlayerColor, string>>,
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
      clearTimeout(this.botTurnTimers.get(gameId)!);
    }
    // Clash freeze: while the QTE or its result card is up, bots stand down.
    const timer = setTimeout(() => {
      this.botTurnTimers.delete(gameId);
      this.store
        .loadGameState(gameId)
        .then((state) => {
          if (!state || state.status !== 'active') return;
          // Pause-air guard: while a bot-mode game is paused, the in-flight bot
          // may finish its chain, but no further triggers run once the turn
          // moves past pauseTurnOwner.
          if (state.paused && state.currentTurn !== state.pauseTurnOwner) return;
          // Clash freeze: while the QTE or its result card is up, bots stand down.
          const freezeUntil = this.clashFreezeUntil.get(gameId);
          if (freezeUntil && Date.now() < freezeUntil) return;
          if (!isBotPlayer(this.userIdMap, gameId, state.currentTurn)) return;

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

  // Freeze bots for a game until `untilMs` (clash QTE announce / result card).
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
