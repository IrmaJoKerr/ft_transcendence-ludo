import { RedisGameStore } from './redis';
import { EventPublisher } from './socket/event-publisher';
import type { PlayerColor, ClashState } from './types';

export const ATTACKER_KEYS = ['u', 'i', 'o', 'h', 'j', 'k', 'b', 'n', 'm'];
export const DEFENDER_KEYS = ['q', 'w', 'e', 'a', 's', 'd', 'z', 'x', 'c'];
export const CLASH_ANNOUNCE_MS = 1500; // big "CLASH!" flash
export const CLASH_COUNTDOWN_MS = 3000; // 3-2-1, keys hidden
export const CLASH_PRESS_MS = 5000; // press race
export const CLASH_RESULT_MS = 2000; // result card (client-displayed)
/** Server freeze after a clash resolves : longer than the client's result card so no move/roll lands while it's visible. */
export const CLASH_RESULT_FREEZE_MS = 4000;
export const CLASH_SWEEP_GRACE_MS = 15000; // outer cleanup bound from clash start
export const CLASH_TARGET = 42;
export const CLASH_PRESS_CAP_MS = 110; // min ms between accepted presses per side (~9 Hz ceiling : at elite-human max, so rapid-fire keyboards can't out-press a human)
// Bot clash presser tuning
// The engine pre-rolls the winner: the winning bot presses faster than the
// loser, so it reaches CLASH_TARGET first while both presses look human.
export const CLASH_BOT_WIN_MS_BASE = 125;        // winner's press interval base (ms)
export const CLASH_BOT_LOSE_MS_BASE = 155;       // loser's press interval base (ms)
export const CLASH_BOT_JITTER_MS = 30;           // random ± spread added to each interval (ms)
export const CLASH_BOT_VS_BOT_WIN_CHANCE = 0.5;  // bot-vs-bot clash: coin flip
export const CLASH_BOT_VS_HUMAN_WIN_CHANCE = 0.25; // bot vs human: bot win chance per clash

export class ClashManager {
  private store: RedisGameStore;
  private publisher: EventPublisher;

  constructor(store: RedisGameStore, publisher: EventPublisher) {
    this.store = store;
    this.publisher = publisher;
  }

  async startClash(gameId: string, attacker: PlayerColor, defender: PlayerColor): Promise<void> {
    const attackerKey = ATTACKER_KEYS[Math.floor(Math.random() * ATTACKER_KEYS.length)];
    const defenderKey = DEFENDER_KEYS[Math.floor(Math.random() * DEFENDER_KEYS.length)];
    const startedAt = Date.now();
    const clashState: ClashState = {
      attacker,
      defender,
      attackerKey,
      defenderKey,
      target: CLASH_TARGET,
      duration: CLASH_PRESS_MS / 1000,
      startedAt,
      announceDeadline: startedAt + CLASH_ANNOUNCE_MS,
      countdownDeadline: startedAt + CLASH_ANNOUNCE_MS + CLASH_COUNTDOWN_MS,
      pressDeadline: startedAt + CLASH_ANNOUNCE_MS + CLASH_COUNTDOWN_MS + CLASH_PRESS_MS,
      phase: 'announce',
      attackerPresses: 0,
      defenderPresses: 0,
      lastPressAt: {},
    };
    await this.store.saveClashState(gameId, clashState);
    this.publisher.publish({
      type: 'clash_start',
      gameId,
      attackerKey,
      defenderKey,
      target: CLASH_TARGET,
      duration: CLASH_PRESS_MS / 1000,
      attacker,
      defender,
      phase: 'announce',
      startAt: startedAt,
      announceDeadline: clashState.announceDeadline,
      countdownDeadline: clashState.countdownDeadline,
      pressDeadline: clashState.pressDeadline,
      attackerPresses: 0,
      defenderPresses: 0,
    });
  }

  /** Record a press: validates pressing phase, key match, press-cap and deadline; bots bypass key/seat checks. */
  async recordPress(gameId: string, color: PlayerColor, key: string, isBot = false): Promise<number> {
    const clash = await this.store.loadClashState(gameId);
    if (!clash) return 0;

    // Only presses during the PRESS phase count; before that the keys aren't revealed.
    if (clash.phase !== 'pressing') return 0;
    if (Date.now() > clash.pressDeadline) return 0;

    if (!isBot) {
      // Validate key matches the player's assigned key.
      const expectedKey = color === clash.attacker ? clash.attackerKey : clash.defenderKey;
      if (key !== expectedKey) return 0;
    }

    // Server-side press cap: min CLASH_PRESS_CAP_MS between accepted presses per side.
    const last = clash.lastPressAt?.[color];
    if (typeof last === 'number' && Date.now() - last < CLASH_PRESS_CAP_MS) return 0;

    const count = await this.store.recordClashPress(gameId, color);
    // Broadcast the live count to EVERYONE in the room so both players' HUDs
    // stay in sync. The caller (socket-handlers) separately gets `count`.
    this.publisher.publish({
      type: 'clash_press',
      gameId,
      color,
      presses: count,
    });
    return count;
  }

  /**
   * Resolve a clash with a winner and loser.
   * Publishes the clash_result event and clears the clash state.
   */
  async resolveClash(gameId: string, winner: PlayerColor, loser: PlayerColor): Promise<void> {
    const clash = await this.store.loadClashState(gameId);
    if (!clash) return;

    this.publisher.publish({
      type: 'clash_result',
      gameId,
      winner,
      loser,
      winnerPresses: winner === clash.attacker ? clash.attackerPresses : clash.defenderPresses,
      loserPresses: loser === clash.attacker ? clash.attackerPresses : clash.defenderPresses
    });

    await this.store.clearClashState(gameId);
  }
}