// The engine's one randomness seam. Six call sites used to reach for
// Math.random() directly: the die seed, the two clash keys, the two bot
// pre-rolls and the bot press jitter. That made every one of them untestable
// without pinning Math.random process-wide, which perturbs all six at once, and
// it left the key schedule and the jitter with no way to be replayed.
//
// So randomness is drawn from a generator that is passed in, never from the
// global: a test owns the stream, the die keeps its seed-then-one-draw shape,
// and a clash carries one generator through its keys, its switch schedule and
// its bot presses.

export type Rng = () => number;

// mulberry32, moved verbatim from LudoEngine's private `seededRand` so the die
// stream is unchanged: same accumulator, same arithmetic, same output. `s` is
// the whole 32-bit state and the period is the full 2^32.
export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    // 0x6d2b79f5: mulberry32's fixed odd accumulator, which cycles s through all
    // 2^32 states (full period); `| 0` wraps the sum back into 32-bit range.
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A seed taken from entropy, never from a clock: a timestamp seed would make
// every roll and every key derivable from the match start time, which is worse
// than what Math.random() gave us.
export function seedFrom(random: Rng = Math.random): number {
  return Math.floor(random() * Number.MAX_SAFE_INTEGER);
}

// Inclusive on both ends, which is what every call site here wants: a die face
// 1..6, a key at index 0..length-1.
export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

// The bot press jitter is the only float: it wants a delay, not an index.
export function randFloat(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[randInt(rng, 0, list.length - 1)];
}

// Picks without replacement (a Fisher-Yates prefix), for the one caller that
// needs it: a key shift must not land on the letter already on screen. The
// take is clamped, so asking for more than the list holds returns the list
// rather than looping.
export function pickDistinct<T>(rng: Rng, list: readonly T[], n: number): T[] {
  const pool = [...list];
  const take = Math.min(Math.max(0, Math.floor(n)), pool.length);
  for (let i = 0; i < take; i++) {
    const j = randInt(rng, i, pool.length - 1);
    const head = pool[i];
    pool[i] = pool[j];
    pool[j] = head;
  }
  return pool.slice(0, take);
}
