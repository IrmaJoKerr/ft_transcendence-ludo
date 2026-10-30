import type { RedisGameStore } from './redis';
import type { EventPublisher } from './socket/event-publisher';
import type { PlayerColor, ClashState, ChainRound, PieceId } from './types';
import { createRng, pick, pickDistinct, randInt, seedFrom } from './rng';
import type { Rng } from './rng';

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
  CLASH_BOT_FAST_MS_BASE,
  CLASH_BOT_CASUAL_MS_BASE,
  CLASH_BOT_JITTER_MS,
  CLASH_BOT_FAST_REACTION_MS,
  CLASH_BOT_CASUAL_REACTION_MS,
  CLASH_SWITCH_FIRST_MIN_MS,
  CLASH_SWITCH_FIRST_MAX_MS,
  CLASH_SWITCH_GAP_MIN_MS,
  CLASH_SWITCH_GAP_MAX_MS,
} from './timing';
import {
  CLASH_ANNOUNCE_MS,
  CLASH_COUNTDOWN_MS,
  CLASH_PRESS_MS,
  CLASH_PRESS_CAP_MS,
  CLASH_SWITCH_FIRST_MIN_MS,
  CLASH_SWITCH_FIRST_MAX_MS,
  CLASH_SWITCH_GAP_MIN_MS,
  CLASH_SWITCH_GAP_MAX_MS,
} from './timing';
export const CLASH_TARGET = 42; // presses needed to win the race
// The most one accepted press may be worth. The touch pad sends 2, because a tap
// on a circle is slower and less repeatable than a held key; the clamp keeps the
// wire from asking for more, so the cap's ceiling stays 2x and no further.
export const CLASH_TAP_COUNT_MAX = 2;
// Bot pacing draws: which profile a bot side runs at. The profile decides the
// press count (38 fast, 33 casual, see clash-pace.ts), so these are the odds of
// DRAWING the fast profile, not a handicap multiplier. Against a passive human
// that is also the odds of winning the clash, which is what the bot's move
// valuation (captureOdds in bot.ts) discounts by.
export const CLASH_BOT_FAST_VS_HUMAN = 0.25; // vs a human seat: 1 in 4 draws fast
export const CLASH_BOT_FAST_VS_BOT = 0.5; // bot vs bot: coin flip decides who is fast

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

// Draw one side's schedule for a round: `count` DISTINCT letters from that side's
// own nine-key pool, so a switch can never land on the letter already on screen.
// `previousLast` is the letter the seat ended the previous round of a CHAIN on:
// round n+1 must not open there, or the seam between two rounds would read as no
// switch at all. The exclusion only applies when a spare letter remains, which the
// nine-key pool always has at the three-letter ceiling.
export function drawKeySchedule(
  rng: Rng,
  pool: readonly string[],
  count: number,
  previousLast?: string,
): string[] {
  const want = Math.min(Math.max(1, Math.floor(count)), pool.length);
  const openers =
    previousLast && pool.length > want ? pool.filter((key) => key !== previousLast) : pool;
  const first = pick(rng, openers);
  return [first, ...pickDistinct(rng, pool.filter((key) => key !== first), want - 1)];
}

// The switch instants, absolute on the engine clock: the first drawn from
// countdownDeadline + 2000..2500, each next 800..1100 after the one before. Drawn
// one at a time so two switches never land on a metronome.
export function switchInstants(rng: Rng, countdownDeadline: number, shift: number): number[] {
  const out: number[] = [];
  let at = countdownDeadline + randInt(rng, CLASH_SWITCH_FIRST_MIN_MS, CLASH_SWITCH_FIRST_MAX_MS);
  for (let i = 0; i < shift; i++) {
    out.push(at);
    at += randInt(rng, CLASH_SWITCH_GAP_MIN_MS, CLASH_SWITCH_GAP_MAX_MS);
  }
  return out;
}

// Which letter of a side's schedule the server is accepting at `now`. A room with
// the mutator off has no schedule at all, which reads as the opening letter alone.
export function switchIndexAt(switchAt: number[] | undefined, now = Date.now()): number {
  let index = 0;
  for (const at of switchAt ?? []) if (now >= at) index++;
  return index;
}

// The letter the server accepts for one seat right now. `recordPress` and the
// socket handler both judge through this, so the two cannot disagree about which
// letter is live, and a press on the outgoing letter simply does not count.
export function keyFor(clash: ClashState, color: PlayerColor, now = Date.now()): string {
  const schedule = color === clash.attacker ? clash.attackerKeys : clash.defenderKeys;
  const opening = color === clash.attacker ? clash.attackerKey : clash.defenderKey;
  const keys = schedule && schedule.length > 0 ? schedule : [opening];
  return keys[Math.min(switchIndexAt(clash.switchAt, now), keys.length - 1)];
}

// ClashManager owns one clash QTE's state: start it, validate and count presses.
// clash-engine.ts applies and publishes the outcome, clears `state.clash`, and owns
// the timers, the recovery sweep and the bot pressers. The clash is stored in the state.
export class ClashManager {
  constructor(
    private store: RedisGameStore,
    private publisher: EventPublisher,
    // Entropy for the key draws, defaulting to the global. ClashEngine hands in
    // the clash's own generator instead, so a round's keys replay with it.
    private random: Rng = Math.random,
  ) {}

  // Start a clash: draw one letter schedule per side, stamp absolute phase deadlines,
  // persist them, then announce. `info` carries the chain counters and this round's
  // defender; absent means one defender, the R = 1 case of the same shape.
  // `rng` is the clash's generator when the caller owns one (ClashEngine does);
  // on its own the manager seeds a fresh one from its entropy source.
  async startClash(
    gameId: string,
    attacker: PlayerColor,
    defender: PlayerColor,
    info?: ChainRound,
    rng: Rng = createRng(seedFrom(this.random)),
  ): Promise<void> {
    // The room's mutator and the chain's seam both live in the game state, so they
    // are read here rather than threaded through two more positional arguments from
    // every caller. The engine's per-game lock covers this call, so the load cannot
    // race a write, and a state that predates the mutator simply reads as 0.
    const state = await this.store.loadGameState(gameId);
    const shift = state?.clashKeyShift === 1 || state?.clashKeyShift === 2 ? state.clashKeyShift : 0;
    const previous = state?.pendingCapture?.lastKeys;
    const attackerKeys = drawKeySchedule(rng, ATTACKER_KEYS, shift + 1, previous?.[attacker]);
    const defenderKeys = drawKeySchedule(rng, DEFENDER_KEYS, shift + 1, previous?.[defender]);
    // The opening letter is also the legacy field, so an older client and the bot
    // pressers keep reading the round the way they always did.
    const attackerKey = attackerKeys[0];
    const defenderKey = defenderKeys[0];
    const startedAt = Date.now();
    const countdownDeadline = startedAt + CLASH_ANNOUNCE_MS + CLASH_COUNTDOWN_MS;
    const switchAt = switchInstants(rng, countdownDeadline, shift);
    // The chain's seam for the next round: what this one ends on, per seat.
    if (state?.pendingCapture) {
      state.pendingCapture.lastKeys = {
        [attacker]: attackerKeys[attackerKeys.length - 1],
        [defender]: defenderKeys[defenderKeys.length - 1],
      };
      await this.store.saveGameState(gameId, state);
    }
    const clashState: ClashState = {
      attacker,
      defender,
      attackerKey,
      defenderKey,
      // Absent rather than empty when the mutator is off: a room that never turns it
      // on carries the same record it always did.
      ...(shift > 0 ? { attackerKeys, defenderKeys, switchAt } : {}),
      target: CLASH_TARGET,
      duration: CLASH_PRESS_MS / 1000,
      startedAt,
      announceDeadline: startedAt + CLASH_ANNOUNCE_MS,
      countdownDeadline,
      pressDeadline: countdownDeadline + CLASH_PRESS_MS,
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
      attackerKeys,
      defenderKeys,
      switchAt,
      keyShift: shift,
      // Stamped once, so every client derives its offset from the same instant the
      // deadlines below were measured from.
      serverNow: startedAt,
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
      // The key must match the letter this seat is being asked for RIGHT NOW: the
      // schedule's live element, not the round's opening letter.
      if (key !== keyFor(clash, color)) return 0;
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
}
