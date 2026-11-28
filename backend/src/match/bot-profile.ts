// A bot seat's four numbers, rolled once at room creation and stored in the match hash.
// The engine reads them verbatim for decisions and clash pace, so play is deterministic.
// The local mulberry32 copy is needed because the backend and engine cannot share imports.
const BOT_FAST_RATE_BASE = 25;
const BOT_RISK_LAST_TOKEN_BASE = 30;
const BOT_RISK_RESERVE_BASE = 60;
// The modifier runs -5..+5, added to all three baselines at once.
const BOT_PERSONALITY_SPREAD = 5;

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A signed 0-5 modifier. The magnitude is drawn 0..5 and then given a sign, so 0
// is twice as likely as any other value.
export function personalityModifier(rand: () => number): number {
  const magnitude = Math.floor(rand() * (BOT_PERSONALITY_SPREAD + 1));
  if (magnitude === 0) return 0;
  return rand() < 0.5 ? -magnitude : magnitude;
}

// The four fields for one bot seat, keyed for the match hash. `slowRate` is
// derived, never rolled: two independent draws could drift and leave the profile
// with no single value to trust.
export function botProfileHashFields(slot: number): Record<string, string> {
  // Seeded from entropy, never from the clock: a room's personality is minor
  // randomness, and a timestamp seed would make it derivable from the room's age.
  const rand = mulberry32(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
  const modifier = personalityModifier(rand);
  const fastRate = BOT_FAST_RATE_BASE + modifier;
  return {
    [`player${slot}_botFastRate`]: String(fastRate),
    [`player${slot}_botSlowRate`]: String(100 - fastRate),
    [`player${slot}_botRiskLastToken`]: String(BOT_RISK_LAST_TOKEN_BASE + modifier),
    [`player${slot}_botRiskReserve`]: String(BOT_RISK_RESERVE_BASE + modifier),
  };
}
