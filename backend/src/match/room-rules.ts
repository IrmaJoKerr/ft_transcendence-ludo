// The four room rules in one place: the wire names (`clashEnabled`, `noSafeZones`,
// `freeExit`, `clashKeyShift`), the `match:*` hash keys the engine reads, the
// defaulting rule and the polarity. A standard room is clash off, free exit off,
// safe zones on, no key switch.
export type RoomRules = {
  clashEnabled: boolean;
  noSafeZones: boolean;
  freeExit: boolean;
  // How many times the required letter changes mid-clash (0, 1 or 2). Forced to 0
  // whenever clash mode is off, so the two can never disagree.
  clashKeyShift: 0 | 1 | 2;
};

// The key-shift count, clamped. Same body as the engine's `clampClashKeyShift`
// (`backend/app/ludo-engine/src/engine.ts`): the two are separate packages with no
// shared import path, so `room-rules-harness.ts` asserts they agree value for value.
// The guest route passes a validated DTO, but the other create routes read one
// `@Body('x')` at a time with no ValidationPipe, so anything can arrive here.
export function clampClashKeyShift(raw: unknown, clashEnabled: boolean): 0 | 1 | 2 {
  if (!clashEnabled) return 0;
  const n =
    typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.min(2, Math.max(0, Math.round(n))) as 0 | 1 | 2;
}

// Wire to rules. The create routes read one `@Body('x')` param at a time, so the
// ValidationPipe never runs and a client can put anything in these fields. Only a
// literal `true` turns a rule on; no input is the standard room.
export function normalizeRoomRules(input?: Partial<RoomRules> | null): RoomRules {
  const clashEnabled = input?.clashEnabled === true;
  return {
    clashEnabled,
    noSafeZones: input?.noSafeZones === true,
    freeExit: input?.freeExit === true,
    clashKeyShift: clampClashKeyShift(input?.clashKeyShift, clashEnabled),
  };
}

// Rules to `match:*` hash fields, for the create hset. Stringified because a Redis
// hash is flat strings, and written even when false so the hash describes its own
// room; the engine treats an absent field as false (and an absent count as 0).
export function roomRuleHashFields(rules: RoomRules): Record<string, string> {
  return {
    clashEnabled: String(rules.clashEnabled),
    noSafeZones: String(rules.noSafeZones),
    freeExit: String(rules.freeExit),
    clashKeyShift: String(rules.clashKeyShift),
  };
}

// `match:*` hash fields -> rules, for the handoff a create/rejoin hands back.
// Absent means false, so a room hash written before this port (no fields at all)
// reads as the standard game : clash off, free exit off, safe zones protecting.
export function readRoomRules(data: Record<string, string>): RoomRules {
  const clashEnabled = data.clashEnabled === 'true';
  return {
    clashEnabled,
    noSafeZones: data.noSafeZones === 'true',
    freeExit: data.freeExit === 'true',
    clashKeyShift: clampClashKeyShift(data.clashKeyShift, clashEnabled),
  };
}
