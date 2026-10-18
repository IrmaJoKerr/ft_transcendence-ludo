import type { RedisGameStore } from './redis';
import type { EventPublisher } from './socket/event-publisher';
import type { PlayerColor, ClashState, ChainRound, PieceId } from './types';

// One key grid per side, split so two players at one keyboard (hotseat) never
// reach for the same key: defender keys are the left-hand block, attacker keys
// the right-hand one.
export const ATTACKER_KEYS = ['u', 'i', 'o', 'h', 'j', 'k', 'b', 'n', 'm'];
export const DEFENDER_KEYS = ['q', 'w', 'e', 'a', 's', 'd', 'z', 'x', 'c'];
// The clash WINDOWS live in ./timing with every other delay; re-exported here so the
// existing imports (clash-engine, socket layer, harnesses) keep their path.
export {
  CLASH_ANNOUNCE_MS,
  CLASH_COUNTDOWN_MS,
  CLASH_PRESS_MS,
  CLASH_RESULT_MS,
  CLASH_RESULT_FREEZE_MS,
  CARD_HOLD_MIN_MS,
  CLASH_SWEEP_GRACE_MS,
  CLASH_PRESS_CAP_MS,
  CLASH_BOT_WIN_MS_BASE,
  CLASH_BOT_LOSE_MS_BASE,
  CLASH_BOT_JITTER_MS,
} from './timing';
import {
  CLASH_ANNOUNCE_MS,
  CLASH_COUNTDOWN_MS,
  CLASH_PRESS_MS,
  CLASH_PRESS_CAP_MS,
} from './timing';
export const CLASH_TARGET = 42; // presses needed to win the race
// The most one accepted press may be worth. The touch pad sends 2, because a tap
// on a circle is slower and less repeatable than a held key; the clamp keeps the
// wire from asking for more, so the cap's ceiling stays 2x and no further.
export const CLASH_TAP_COUNT_MAX = 2;
// Bot presser tuning: the engine pre-rolls the winner, so the winning bot
// presses faster than the losing one while both look human.
export const CLASH_BOT_VS_BOT_WIN_CHANCE = 0.5; // bot vs bot: coin flip
export const CLASH_BOT_VS_HUMAN_WIN_CHANCE = 0.25; // bot vs human: bot win chance

// Fight a wall in ascending piece-id order so a chain is deterministic across
// loads and state rebuilds. Ids are `{color}-{index}`; a malformed id sorts last,
// and the id breaks ties.
export function orderDefenderIds(pieceIds: PieceId[]): PieceId[] {
  const indexOf = (id: PieceId): number => {
    const suffix = Number(id.slice(id.lastIndexOf('-') + 1));
    return Number.isFinite(suffix) ? suffix : Number.MAX_SAFE_INTEGER;
  };
  return [...pieceIds].sort((a, b) => indexOf(a) - indexOf(b) || (a < b ? -1 : a > b ? 1 : 0));
}

// ClashManager owns one clash QTE: start, validate and count presses, publish the
// result, then clear it. Timers, the recovery sweep and bot pressers live in
// clash-engine.ts; the clash is persisted inside the game state.
export class ClashManager {
  constructor(
    private store: RedisGameStore,
    private publisher: EventPublisher,
  ) {}

  // Start a clash: pick one key per side, stamp absolute phase deadlines, persist
  // them, then announce. `info` carries the chain counters and this round's
  // defender; absent means one defender, the R = 1 case of the same shape.
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

  // Record one press. Return 0 and store nothing when the press phase has not
  // started, the deadline has passed, the key is not this player's or the press
  // falls inside the per-side cap. Bots skip the key check.
  async recordPress(
    gameId: string,
    color: PlayerColor,
    key: string,
    isBot = false,
    count = 1,
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

    // Server-side press cap: a minimum gap between accepted presses per side. The
    // cap gates the EVENT, so the tablet's tap weight (below) cannot buy a faster
    // event stream, only a heavier press once one is accepted.
    const last = clash.lastPressAt?.[color];
    if (typeof last === 'number' && Date.now() - last < CLASH_PRESS_CAP_MS) return 0;

    // Tablet tap weight: one tap counts as several presses because tapping is
    // slower than holding a key. Clamp it here, on the server, so the wire cannot
    // ask for more than the documented weight.
    const weight = Math.min(CLASH_TAP_COUNT_MAX, Math.max(1, Math.floor(count) || 1));
    const meter = await this.store.recordClashPress(gameId, color, weight);
    // Broadcast the live count to the whole room so both HUDs stay in step. The
    // caller (clash-engine / socket-handlers) separately receives `meter`.
    this.publisher.publish({
      type: 'clash_press',
      gameId,
      color,
      presses: meter,
    });
    return meter;
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
