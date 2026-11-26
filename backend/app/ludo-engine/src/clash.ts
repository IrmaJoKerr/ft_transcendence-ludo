import type { RedisGameStore } from './redis';
import type { EventPublisher } from './socket/event-publisher';
import type { PlayerColor, ClashState, ChainRound, PieceId } from './types';
import { createRng, pick, randInt, seedFrom } from './rng';
import type { Rng } from './rng';

// One key grid per side, split so two players at one keyboard (hotseat) never
// reach for the same key: defender keys are the left-hand block, attacker keys
// the right-hand one.
export const ATTACKER_KEYS = ['u', 'i', 'o', 'h', 'j', 'k', 'b', 'n', 'm'];
export const DEFENDER_KEYS = ['q', 'w', 'e', 'a', 's', 'd', 'z', 'x', 'c'];
// Shared clash windows and card lengths are re-exported here so existing imports keep
// their path. Engine-only clash delays stay in `timing.ts`.
export {
  CLASH_ANNOUNCE_MS,
  CLASH_COUNTDOWN_MS,
  CLASH_PRESS_MS,
  CLASH_RESULT_MS,
  CLASH_WALL_RESULT_MS,
  CLASH_BREACH_RESULT_MS,
  CLASH_TEXT_ONLY_MS,
  CARD_HOLD_MARGIN_MS,
} from './__shared__/timing.constants';
export {
  CLASH_RESULT_FREEZE_MS,
  CARD_HOLD_MIN_MS,
  CLASH_SWEEP_GRACE_MS,
  CLASH_PRESS_CAP_MS,
  CLASH_BOT_FAST_MS_BASE,
  CLASH_BOT_CASUAL_MS_BASE,
  CLASH_BOT_JITTER_MS,
  // The two reaction constants are NOT re-exported here: nothing outside the pacing
  // module reads them (the live reader is `CLASH_BOT_REACTION_MS` in clash-pace.ts),
  // and two dead re-exports were removed with the 2026-11-09 pass.
  CLASH_BOT_REREAD_MS,
  CLASH_SWITCH_FIRST_MIN_MS,
  CLASH_SWITCH_FIRST_MAX_MS,
  CLASH_SWITCH_GAP_MIN_MS,
  CLASH_SWITCH_GAP_MAX_MS,
} from './timing';
import {
  CLASH_ANNOUNCE_MS,
  CLASH_COUNTDOWN_MS,
  CLASH_PRESS_MS,
} from './__shared__/timing.constants';
import { CLASH_TAP_COUNT } from './__shared__/clash.constants';
import {
  CLASH_KEYSHIFT_EXTRA_MS,
  CLASH_PRESS_CAP_MS,
  CLASH_SWITCH_FIRST_MIN_MS,
  CLASH_SWITCH_FIRST_MAX_MS,
  CLASH_SWITCH_GAP_MIN_MS,
  CLASH_SWITCH_GAP_MAX_MS,
} from './timing';
export const CLASH_TARGET = 42; // the base presses to win the race (a key-shift room scales it)
// One press is capped by shared `CLASH_TAP_COUNT`; bot odds choose the pace profile,
// not a handicap. Against a passive human, the same odds are the win chance.
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

function shuffleInPlace<T>(rng: Rng, list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = randInt(rng, 0, i);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function combinations<T>(list: readonly T[], take: number): T[][] {
  if (take === 0) return [[]];
  if (list.length < take) return [];
  const [head, ...rest] = list;
  const withHead = combinations(rest, take - 1).map((row) => [head, ...row]);
  return [...withHead, ...combinations(rest, take)];
}

function permutations<T>(list: readonly T[]): T[][] {
  if (list.length <= 1) return [[...list]];
  const out: T[][] = [];
  for (let i = 0; i < list.length; i++) {
    const head = list[i];
    const rest = [...list.slice(0, i), ...list.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([head, ...tail]);
  }
  return out;
}

// One side's ordered pads: four distinct pool letters, no letter shared with the
// preceding pad, at most two of a letter in one position, and the accepted key on
// its pad. Backtracking has a fixed budget and a shaped fallback.
export function drawClashPads(
  rng: Rng,
  pool: readonly string[],
  count: number,
  history: readonly string[][] = [],
  previousLast?: string,
): { pads: string[][]; keys: string[] } {
  const want = Math.min(Math.max(1, Math.floor(count)), 3);
  const historyLast = history.length > 0 ? history[history.length - 1] : undefined;
  const previous = new Set(historyLast ?? (previousLast ? [previousLast] : []));

  const candidatesFor = (
    previousPad: ReadonlySet<string>,
    counts: ReadonlyArray<Map<string, number>>,
  ): string[][] => {
    const available = pool.filter((key) => !previousPad.has(key));
    const out: string[][] = [];
    for (const subset of combinations(available, 4)) {
      for (const order of permutations(subset)) {
        if (order.every((key, position) => (counts[position]?.get(key) ?? 0) < 2)) {
          out.push(order);
        }
      }
    }
    return out;
  };

  let visited = 0;
  const search = (
    index: number,
    previousPad: ReadonlySet<string>,
    counts: ReadonlyArray<Map<string, number>>,
  ): string[][] | null => {
    if (index === want) return [];
    if (visited > 20_000) return null;
    const candidates = shuffleInPlace(rng, candidatesFor(previousPad, counts));
    for (const pad of candidates) {
      visited += 1;
      const nextCounts = counts.map((byKey) => new Map(byKey));
      pad.forEach((key, position) => {
        nextCounts[position].set(key, (nextCounts[position].get(key) ?? 0) + 1);
      });
      const rest = search(index + 1, new Set(pad), nextCounts);
      if (rest) return [pad, ...rest];
    }
    return null;
  };

  let pads: string[][] | null = null;
  for (let walk = 0; walk < 32 && !pads; walk++) {
    visited = 0;
    pads = search(0, previous, Array.from({ length: 4 }, () => new Map<string, number>()));
  }

  if (!pads) {
    // A corrupt or over-full injected history can exhaust the capped search. Keep
    // the two hard shapes (four distinct pool letters, adjacent pads disjoint) and
    // drop only the per-position cap so the clash still gets a package.
    pads = [];
    let previousPad = previous;
    for (let index = 0; index < want; index++) {
      const available = pool.filter((key) => !previousPad.has(key));
      const pad = shuffleInPlace(rng, [...available]).slice(0, 4);
      for (const key of pool) {
        if (pad.length === 4) break;
        if (!pad.includes(key) && !previousPad.has(key)) pad.push(key);
      }
      pads.push(pad);
      previousPad = new Set(pad);
    }
  }

  return { pads, keys: pads.map((pad) => pick(rng, pad)) };
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

  // Draw schedules, stamp absolute deadlines, persist, then announce. `info` carries
  // chain counters; absent means the single-defender case.
  async startClash(
    gameId: string,
    attacker: PlayerColor,
    defender: PlayerColor,
    info?: ChainRound,
    rng: Rng = createRng(seedFrom(this.random)),
  ): Promise<void> {
    // Mutator and chain seam come from state. The per-game lock makes the load safe;
    // older state reads as no mutator.
    const state = await this.store.loadGameState(gameId);
    const shift = state?.clashKeyShift === 1 || state?.clashKeyShift === 2 ? state.clashKeyShift : 0;
    const previous = state?.pendingCapture?.lastKeys;
    const attackerDraw = drawClashPads(
      rng,
      ATTACKER_KEYS,
      shift + 1,
      state?.pendingCapture?.padHistory?.[attacker] ?? [],
      previous?.[attacker],
    );
    const defenderDraw = drawClashPads(
      rng,
      DEFENDER_KEYS,
      shift + 1,
      state?.pendingCapture?.padHistory?.[defender] ?? [],
      previous?.[defender],
    );
    const attackerKeys = attackerDraw.keys;
    const defenderKeys = defenderDraw.keys;
    const attackerPads = attackerDraw.pads;
    const defenderPads = defenderDraw.pads;
    // The opening letter is also the legacy field, so an older client and the bot
    // pressers keep reading the round the way they always did.
    const attackerKey = attackerKeys[0];
    const defenderKey = defenderKeys[0];
    const startedAt = Date.now();
    const countdownDeadline = startedAt + CLASH_ANNOUNCE_MS + CLASH_COUNTDOWN_MS;
    const switchAt = switchInstants(rng, countdownDeadline, shift);
    // Each shift widens the window, so the target scales with it. A fixed target would
    // make a shifted room easier: 42 / 5000, 55 / 6500, 67 / 8000.
    const pressMs = CLASH_PRESS_MS + CLASH_KEYSHIFT_EXTRA_MS * shift;
    const target = Math.round((CLASH_TARGET * pressMs) / CLASH_PRESS_MS);
    // The chain's seam for the next round: what this one ends on, per seat.
    if (state?.pendingCapture) {
      state.pendingCapture.lastKeys = {
        [attacker]: attackerKeys[attackerKeys.length - 1],
        [defender]: defenderKeys[defenderKeys.length - 1],
      };
      // The pad history is the chain's authoritative seam record. The per-position
      // cap counts only this round's pads, so an earlier round is appended, never
      // re-counted.
      state.pendingCapture.padHistory = {
        ...state.pendingCapture.padHistory,
        [attacker]: [...(state.pendingCapture.padHistory?.[attacker] ?? []), ...attackerPads],
        [defender]: [...(state.pendingCapture.padHistory?.[defender] ?? []), ...defenderPads],
      };
      await this.store.saveGameState(gameId, state);
    }
    const clashState: ClashState = {
      attacker,
      defender,
      attackerKey,
      defenderKey,
      // Absent rather than empty when the mutator is off: a room that never turns it
      // on carries the same schedule record it always did. The pads are always
      // present, one entry per side, because the touch pad paints them at any shift.
      ...(shift > 0 ? { attackerKeys, defenderKeys, switchAt } : {}),
      attackerPads,
      defenderPads,
      target,
      duration: pressMs / 1000,
      startedAt,
      announceDeadline: startedAt + CLASH_ANNOUNCE_MS,
      countdownDeadline,
      pressDeadline: countdownDeadline + pressMs,
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
      attackerPads,
      defenderPads,
      switchAt,
      keyShift: shift,
      // Stamped once, so every client derives its offset from the same instant the
      // deadlines below were measured from.
      serverNow: startedAt,
      target,
      duration: pressMs / 1000,
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

  // Record one press. Invalid phase, expired deadline, wrong key or cap returns meter 0
  // and stores nothing; bots skip the key check. Success also returns the scaled target.
  async recordPress(
    gameId: string,
    color: PlayerColor,
    key: string,
    isBot = false,
    count = 1,
  ): Promise<{ meter: number; target: number }> {
    const clash = await this.store.loadClashState(gameId);
    if (!clash) return { meter: 0, target: 0 };

    // Only presses during the press phase count: before it, the keys are hidden.
    if (clash.phase !== 'pressing') return { meter: 0, target: 0 };
    if (Date.now() > clash.pressDeadline) return { meter: 0, target: 0 };

    if (!isBot) {
      // The key must match the letter this seat is being asked for RIGHT NOW: the
      // schedule's live element, not the round's opening letter.
      if (key !== keyFor(clash, color)) return { meter: 0, target: 0 };
    }

    // Server-side press cap: a minimum gap between accepted presses per side. The
    // cap gates the EVENT, so the tablet's tap weight (below) cannot buy a faster
    // event stream, only a heavier press once one is accepted.
    const last = clash.lastPressAt?.[color];
    if (typeof last === 'number' && Date.now() - last < CLASH_PRESS_CAP_MS) {
      return { meter: 0, target: 0 };
    }

    // Tablet tap weight: clamp on the server to shared `CLASH_TAP_COUNT`. The finite
    // guard and rounding make NaN read as 1 and keep a fraction from truncating to 0.
    const weight = Math.min(
      CLASH_TAP_COUNT,
      Math.max(1, Math.round(Number.isFinite(count) ? count : 1)),
    );
    const meter = await this.store.recordClashPress(gameId, color, weight);
    // Broadcast the live count to the whole room so both HUDs stay in step. The
    // caller (clash-engine / socket-handlers) separately receives `meter`.
    this.publisher.publish({
      type: 'clash_press',
      gameId,
      color,
      presses: meter,
    });
    return { meter, target: clash.target };
  }
}
