// Bot pacing for the clash QTE: the PRESS TARGET is the contract, the interval
// is derived. A bot side is asked for 38 presses (fast) or 33 (casual) and the
// schedule is fitted into the press window, so the count holds for every draw
// instead of falling out of a chosen millisecond base. What is fixed and what is
// drawn is deliberate: the reaction pause and the base interval are CONSTANTS per
// profile, so the profile is the hesitation, while the jitter on the gaps is the
// only randomness left — the tempo of the mashing. Everything here is pure: the
// engine schedules what this returns, the harness asserts it directly.
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

// The user-facing contract (2026-10-29): 38 and 33 presses, counted INCLUDING
// the reaction pause. A 38-press bot cannot reach CLASH_TARGET (42), so the fast
// profile can only win the comparison at the deadline, never knock the other
// side out early.
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

// The reaction pause, one constant per profile: how long a side needs to see its
// letter and get a finger onto it. Fast is recognition plus muscle memory (200 ms,
// just above the touch-typist band); casual pays choice reaction time, decoding the
// letter and picking the finger (600 ms, the top of the 400..600 band). Deliberately
// NOT jittered, and the same for every round: the hesitation is the profile, so a
// fast bot always opens at the same moment and the only variation left in a schedule
// is the mash tempo. Both numbers widened on 2026-11-09 (4.7) because the letters
// change mid-round: see `CLASH_BOT_REREAD_MS` for the switch's own charge.
export const CLASH_BOT_REACTION_MS: Record<BotPaceKind, number> = {
  fast: CLASH_BOT_FAST_REACTION_MS,
  casual: CLASH_BOT_CASUAL_REACTION_MS,
};

// What a mid-clash letter switch costs a bot, and what the window already pays for
// it: the absolute instants the letters change, and the extension the key-shift
// mutator granted the press window (`CLASH_KEYSHIFT_EXTRA_MS` per switch, already
// added to the deadline and to the target). The schedule spends one
// `CLASH_BOT_REREAD_MS` per switch out of that extension, so a bot pays the re-read
// a human pays without a press ever leaving the window.
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

// Absolute press times for one bot side, `pace.presses` of them, all inside the
// press window and all at least one base interval apart.
//
// The gap shape is the MASH TEMPO: `base x ramp` for the opening three gaps, then
// `base`, with a uniform `0..CLASH_BOT_JITTER_MS` on every gap. The reaction pause
// is a constant in front of it, not part of the draw. If the drawn gaps would run
// past the window, the JITTER is scaled down (never the base and never the count),
// so the last press is always the nth one, inside the window. `base` sits just
// above CLASH_PRESS_CAP_MS, which is why the floor holds even though bots
// currently reach the store directly.
export function botPressTimes(
  pace: BotPace,
  startAt: number,
  rng: Rng,
  switches?: BotSwitchCost,
): number[] {
  // The window this schedule has to fit in: the plain press window plus whatever the
  // key-shift mutator already paid for it. Absent `switches` — a plain room, or a bot
  // schedule replayed from an older state — leaves it at exactly `CLASH_PRESS_MS`,
  // which is today's behaviour to the millisecond.
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

  // The fit: whatever the window has left after the base and the pauses is the
  // jitter budget. The pauses are the bigger half of it — 200 ms fast, 600 ms casual,
  // plus one 150 ms re-read per switch — so the room is ~540 ms for 37 gaps on fast
  // and ~110 ms for 32 on casual, against ~555 and ~480 ms of drawn jitter: the fast
  // schedule keeps almost all its spread and the casual one is compressed to about a
  // quarter, which reads as a metronome. The gaps keep their variation; the mean
  // lands on the interval the target needs, and neither the base nor the count moves.
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
  // Each press carries the re-reads paid before it, so the pause lands where the
  // letters changed rather than in front of the whole schedule: the first press at or
  // after a switch is 150 ms late, and nothing before it moves. The budget above
  // already gave those milliseconds up, so the last press still lands one tail guard
  // inside the window.
  if (switchAt.length === 0) return times;
  return times.map((t) => t + CLASH_BOT_REREAD_MS * switchAt.filter((at) => at <= t).length);
}
