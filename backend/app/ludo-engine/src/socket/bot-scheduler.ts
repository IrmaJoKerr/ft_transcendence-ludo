import { LudoEngine } from '../engine';
import { RedisGameStore } from '../redis';
import { LudoBot, isBotPlayer } from '../bot';
import type { PlayerColor } from '../types';

/**
 * BotTurnScheduler owns bot turn timing. It keeps one timer per game (never
 * stacked) and a hard-freeze map so bots stand down while the clash QTE or
 * its result card is showing. SocketServer is the only caller: it schedules
 * bot turns from engine events and from the bot-slot join path.
 */
export class BotTurnScheduler {
  private botTurnTimers = new Map<string, NodeJS.Timeout>();
  /** Hard freeze: while now < clashFreezeUntil[gameId], NO bot turns fire
   *  (the clash QTE or its 3s result card is showing). Human turns are
   *  gated server-side by state.resultCardUntil; bots need this map because
   *  they act outside the human input path. */
  private clashFreezeUntil = new Map<string, number>();

  constructor(
    private store: RedisGameStore,
    private engine: LudoEngine,
    private userIdMap: Map<string, Map<PlayerColor, string>>,
    private getOrCreateBot: (gameId: string, color: PlayerColor, engine: LudoEngine, store: RedisGameStore) => LudoBot,
  ) {}

  /**
   * If the current turn belongs to a bot, execute its turn after `delayMs`.
   * The delay lets any in-flight move-animation on the frontend finish
   * before the bot's next action is broadcast. Runs inside the queue so
   * it's serialized with human moves and cannot overlap.
   */
  schedule(gameId: string, delayMs: number): void {
    // Cancel an old timer for this game so we never stack overlapping bot
    // turns (safer than relying on takeTurn's phase guard alone).
    if (this.botTurnTimers.has(gameId)) {
      clearTimeout(this.botTurnTimers.get(gameId)!);
    }
    const timer = setTimeout(() => {
      this.botTurnTimers.delete(gameId);
      this.store.loadGameState(gameId).then(state => {
        if (!state || state.status !== 'active') return;
        // Pause-air guard: while a bot-mode game is paused, the IN-FLIGHT
        // bot (currentTurn === pauseTurnOwner) may finish its action chain,
        // but as soon as the turn moves to a different color the pause
        // boundary has been reached and no further triggers run.
        if (state.paused && state.currentTurn !== state.pauseTurnOwner) return;
        // Clash freeze: while the QTE or its result card is up, bots stand down.
        const freezeUntil = this.clashFreezeUntil.get(gameId);
        if (freezeUntil && Date.now() < freezeUntil) return;
        if (!isBotPlayer(this.userIdMap, gameId, state.currentTurn)) return;

        const bot = this.getOrCreateBot(gameId, state.currentTurn, this.engine, this.store);
        // takeTurn() already catches its own engine-call failures, but this
        // is fire-and-forget (never awaited) : a rejection here would be an
        // unhandled promise rejection that crashes the whole engine process,
        // not just this one game. Belt-and-suspenders against future
        // refactors reintroducing that.
        bot.takeTurn().catch((err) => {
          console.error(`[bot] unexpected takeTurn rejection for game ${gameId}:`, err instanceof Error ? err.message : err);
        });
        // Bonus roll / capture chains emit piece_moved -> engine event -> schedule again
      }).catch((err) => {
        console.error(`[bot] failed to load game state for ${gameId}:`, err instanceof Error ? err.message : err);
      });
    }, delayMs);
    this.botTurnTimers.set(gameId, timer);
  }

  /** Freeze bots for a game until `untilMs` (clash QTE announce / result card). */
  setClashFreeze(gameId: string, untilMs: number): void {
    this.clashFreezeUntil.set(gameId, untilMs);
  }

  /** Drop this game's bot-turn state (pending timers + clash freeze). */
  clear(gameId: string): void {
    const timer = this.botTurnTimers.get(gameId);
    if (timer) clearTimeout(timer);
    this.botTurnTimers.delete(gameId);
    this.clashFreezeUntil.delete(gameId);
  }
}