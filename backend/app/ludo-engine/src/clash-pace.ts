// Bot pacing for the clash QTE: the press target is fixed and the interval is fitted to
// the window. Reaction and base are per-profile constants; only gap jitter is drawn.
// The function is pure, so the engine schedules its output and the harness asserts it.
import {
  CLASH_BOT_CASUAL_MS_BASE,
  CLASH_BOT_CASUAL_REACTION_MS,
  CLASH_BOT_FAST_MS_BASE,
  CLASH_BOT_FAST_REACTION_MS,
  CLASH_BOT_JITTER_MS,
  CLASH_BOT_REREAD_MS,
} from './timing';
import { CLASH_PRESS_MS } from './__shared__/timing.constants';
import { randFloat, randInt } from './rng';
import type { Rng } from './rng';

export type BotPaceKind = 'fast' | 'casual';

// What one bot side presses like: the target it must reach, and the pause it
// pays before the first press (a constant per profile, never drawn).
export interface BotPace {
  kind: BotPaceKind;
  presses: number;
  reactionMs: number;
}

// Press targets include the reaction pause. Fast (38) cannot reach the 42-press target,
// so it can only win at the deadline, never end the round early.
export const CLASH_BOT_PRESS_TARGETS: Record<BotPaceKind, number> = {
  fast: 38,
  casual: 33,
};

// The opening is human-shaped: the first three mashing gaps are stretched so a
// bot does not rattle from the first millisecond like a metronome.
const CLASH_BOT_RAMP = [1.25, 1.15, 1.07] as const;

// The last press lands this far inside the window, so the store write and the
// broadcast finish before the press-deadline resolver (which fires at the exact
// deadline) reads the meters.
const CLASH_BOT_TAIL_GUARD_MS = 100;

// Fixed reaction pause per profile, never jittered: 400 ms for fast recognition and
// muscle memory, 700 ms for casual choice reaction. Mid-round switches add
// `CLASH_BOT_REREAD_MS`.
export const CLASH_BOT_REACTION_MS: Record<BotPaceKind, number> = {
  fast: CLASH_BOT_FAST_REACTION_MS,
  casual: CLASH_BOT_CASUAL_REACTION_MS,
};

// Mid-clash switch cost: the absolute switch instants plus the window extension the
// key-shift mutator grants. Each switch spends one `CLASH_BOT_REREAD_MS` from that
// extension, so the re-read never pushes a press outside the window.
export interface BotSwitchCost {
  at: number[];
  extraMs: number;
}

// One stumble, casual profile only: the slower profile is the one that fumbles.
// It is charged to the jitter budget below, never to the press count.
const CLASH_BOT_STUMBLE_CHANCE = 0.03;
const CLASH_BOT_STUMBLE_MIN_MS = 150;
const CLASH_BOT_STUMBLE_MAX_MS = 250;

export function botPace(kind: BotPaceKind): BotPace {
  return { kind, presses: CLASH_BOT_PRESS_TARGETS[kind], reactionMs: CLASH_BOT_REACTION_MS[kind] };
}

// Absolute press times for one bot side: ramp the first three gaps, then base plus
// uniform jitter. If the draw overruns, only jitter is scaled down, so the count and
// the minimum interval hold and the last press stays inside the window.
export function botPressTimes(
  pace: BotPace,
  startAt: number,
  rng: Rng,
  switches?: BotSwitchCost,
): number[] {
  // Fit window: the plain press window plus any key-shift extension. No switches keeps
  // the exact `CLASH_PRESS_MS` behaviour.
  const windowMs = CLASH_PRESS_MS + Math.max(0, switches?.extraMs ?? 0);
  // Only the switches inside this window cost this side anything, and each one is a
  // re-read: the letter it was aiming at is gone.
  const switchAt = (switches?.at ?? [])
    .filter((at) => at > startAt && at < startAt + windowMs)
    .sort((a, b) => a - b);

  const gaps = pace.presses - 1;
  if (gaps <= 0) return [startAt + pace.reactionMs + CLASH_BOT_REREAD_MS * switchAt.length];

  const base = pace.kind === 'fast' ? CLASH_BOT_FAST_MS_BASE : CLASH_BOT_CASUAL_MS_BASE;
  // What the ramp costs on top of a flat base: the three stretched gaps.
  const rampExtra = CLASH_BOT_RAMP.reduce((sum, r) => sum + (r - 1), 0);
  const baseTotal = gaps * base + base * rampExtra;

  // The stumble (casual only) adds to one gap, and comes out of the budget
  // below so it costs jitter rather than a press.
  const stumble =
    pace.kind === 'casual' && rng() < CLASH_BOT_STUMBLE_CHANCE
      ? randFloat(rng, CLASH_BOT_STUMBLE_MIN_MS, CLASH_BOT_STUMBLE_MAX_MS)
      : 0;
  const stumbleAt = stumble > 0 ? randInt(rng, 0, gaps - 1) : -1;

  const jitter: number[] = [];
  for (let i = 0; i < gaps; i++) jitter.push(randFloat(rng, 0, CLASH_BOT_JITTER_MS));
  if (stumbleAt >= 0) jitter[stumbleAt] += stumble;

  // Jitter budget: whatever the window leaves after base and pauses. Only the draw is
  // scaled; the mean interval, base and press count stay fixed.
  const pause = pace.reactionMs + CLASH_BOT_REREAD_MS * switchAt.length;
  const budget = windowMs - pause - CLASH_BOT_TAIL_GUARD_MS - baseTotal;
  const drawn = jitter.reduce((sum, j) => sum + j, 0);
  const scale = drawn > budget ? Math.max(0, budget) / drawn : 1;

  const times: number[] = [startAt + pace.reactionMs];
  let elapsed = pace.reactionMs;
  for (let i = 0; i < gaps; i++) {
    elapsed += base * (CLASH_BOT_RAMP[i] ?? 1) + jitter[i] * scale;
    times.push(startAt + elapsed);
  }
  // Charge each re-read where the letter changed, not at the front of the schedule.
  // The budget already reserved those milliseconds, so the last press still fits.
  if (switchAt.length === 0) return times;
  return times.map((t) => t + CLASH_BOT_REREAD_MS * switchAt.filter((at) => at <= t).length);
}
