import type { RedisGameStore } from './redis';
import type { EventPublisher } from './socket/event-publisher';
import type { PlayerColor, ClashState, ChainRound, PieceId } from './types';

// One key grid per side, split so two players at one keyboard (hotseat) never
// reach for the same key: defender keys are the left-hand block, attacker keys
// the right-hand one.
export const ATTACKER_KEYS = ['u', 'i', 'o', 'h', 'j', 'k', 'b', 'n', 'm'];
export const DEFENDER_KEYS = ['q', 'w', 'e', 'a', 's', 'd', 'z', 'x', 'c'];
export const CLASH_ANNOUNCE_MS = 1500; // "CLASH!" flash, keys still hidden
export const CLASH_COUNTDOWN_MS = 3000; // 3-2-1, keys still hidden
export const CLASH_PRESS_MS = 5000; // press race window
export const CLASH_RESULT_MS = 2000; // result card, displayed by the client
// Server freeze after a clash resolves: longer than the client's result card,
// so no roll or move can land while the card is visible.
export const CLASH_RESULT_FREEZE_MS = 4000;
export const CLASH_SWEEP_GRACE_MS = 15000; // outer cleanup bound from clash start
export const CLASH_TARGET = 42; // presses needed to win the race
// Min ms between accepted presses per side (~9 Hz). Rapid-fire keyboards cannot
// out-press a human, and the cap bounds abuse without a rate-limit carve-out.
export const CLASH_PRESS_CAP_MS = 110;
// Bot presser tuning: the engine pre-rolls the winner, so the winning bot
// presses faster than the losing one while both look human.
export const CLASH_BOT_WIN_MS_BASE = 125; // winner's press interval base (ms)
export const CLASH_BOT_LOSE_MS_BASE = 155; // loser's press interval base (ms)
export const CLASH_BOT_JITTER_MS = 30; // random ± spread added to each interval
export const CLASH_BOT_VS_BOT_WIN_CHANCE = 0.5; // bot vs bot: coin flip
export const CLASH_BOT_VS_HUMAN_WIN_CHANCE = 0.25; // bot vs human: bot win chance

// A wall is fought in ascending piece-id order, so a chain is deterministic: the
// same board always fights `red-0` before `red-3`, whatever order the pieces
// happen to sit in the state array (which is rebuilt from Redis on every load).
// Ids are `{color}-{index}` (see PieceId); a malformed id sorts last, and a tie
// is broken by the id itself so the order never depends on the input order.
export function orderDefenderIds(pieceIds: PieceId[]): PieceId[] {
  const indexOf = (id: PieceId): number => {
    const suffix = Number(id.slice(id.lastIndexOf('-') + 1));
    return Number.isFinite(suffix) ? suffix : Number.MAX_SAFE_INTEGER;
  };
  return [...pieceIds].sort((a, b) => indexOf(a) - indexOf(b) || (a < b ? -1 : a > b ? 1 : 0));
}

// ClashManager owns one clash QTE's lifecycle: start it, validate and count
// presses, publish the result and clear it. Phase timers, the recovery sweep and
// bot pressers live in clash-engine.ts; the clash itself is persisted inside the
// game state (see redis.ts), so a restart can replay it.
export class ClashManager {
  constructor(
    private store: RedisGameStore,
    private publisher: EventPublisher,
  ) {}

  // Start a clash: pick one key per side, stamp the absolute phase deadlines,
  // persist them, then announce. Deadlines are absolute timestamps rather than
  // delays, which is what lets a restarted engine re-arm the same window. `info`
  // carries the chain's counters and the defender of this round: absent means a
  // single-defender clash, the R = 1 case of the same shape.
  async startClash(
    gameId: string,
    attacker: PlayerColor,
    defender: PlayerColor,
    info?: ChainRound,
  ): Promise<void> {
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
      round: info?.round ?? 1,
      totalRounds: info?.totalRounds ?? 1,
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
      round: clashState.round,
      totalRounds: clashState.totalRounds,
      // Only a chain names the defender of the round: a single-defender clash
      // already shows it as the side of the conflict.
      ...(info?.defenderPieceId === undefined ? {} : { defenderPieceId: info.defenderPieceId }),
      ...(info?.remainingDefenderIds === undefined
        ? {}
        : { remainingDefenderIds: info.remainingDefenderIds }),
    });
  }

  // Record one press. Rejected (returns 0, stores nothing) when the press phase
  // has not started, the deadline has passed, the key is not this player's, or
  // the press falls inside the per-side cap. Bots skip the key check because
  // they press their own side programmatically.
  async recordPress(
    gameId: string,
    color: PlayerColor,
    key: string,
    isBot = false,
  ): Promise<number> {
    const clash = await this.store.loadClashState(gameId);
    if (!clash) return 0;

    // Only presses during the press phase count: before it, the keys are hidden.
    if (clash.phase !== 'pressing') return 0;
    if (Date.now() > clash.pressDeadline) return 0;

    if (!isBot) {
      // The key must match the one this player was assigned.
      const expectedKey = color === clash.attacker ? clash.attackerKey : clash.defenderKey;
      if (key !== expectedKey) return 0;
    }

    // Server-side press cap: a minimum gap between accepted presses per side.
    const last = clash.lastPressAt?.[color];
    if (typeof last === 'number' && Date.now() - last < CLASH_PRESS_CAP_MS) return 0;

    const count = await this.store.recordClashPress(gameId, color);
    // Broadcast the live count to the whole room so both HUDs stay in step. The
    // caller (clash-engine / socket-handlers) separately receives `count`.
    this.publisher.publish({
      type: 'clash_press',
      gameId,
      color,
      presses: count,
    });
    return count;
  }

  // Publish the outcome and clear the clash. The deferred move is applied by the
  // caller (clash-engine.ts resolveClashOutcome), which owns the game lock.
  async resolveClash(gameId: string, winner: PlayerColor, loser: PlayerColor): Promise<void> {
    const clash = await this.store.loadClashState(gameId);
    if (!clash) return;

    this.publisher.publish({
      type: 'clash_result',
      gameId,
      winner,
      loser,
      winnerPresses: winner === clash.attacker ? clash.attackerPresses : clash.defenderPresses,
      loserPresses: loser === clash.attacker ? clash.attackerPresses : clash.defenderPresses,
    });

    await this.store.clearClashState(gameId);
  }
}

