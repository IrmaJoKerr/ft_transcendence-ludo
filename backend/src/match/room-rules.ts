// The three room rules in ONE place: the wire names the create body carries
// (`clashEnabled`, `noSafeZones`, `freeExit`), the `match:*` hash keys the engine
// reads back, the defaulting rule between them, and the polarity.
//
// A standard room is clash off, free exit off, safe zones ON, and the safe-zone
// rule is stored INVERTED as `noSafeZones` so all three agree on their polarity
// (false = the variant is off). The inversion is exactly why these travel as one
// object with one reader and one writer per direction: three loose fields at each
// site would have to agree on polarity at every one of them.
export type RoomRules = {
  clashEnabled: boolean;
  noSafeZones: boolean;
  freeExit: boolean;
};

// Wire -> rules. The create routes read their body one `@Body('x')` param at a
// time, so the global ValidationPipe never runs on them (no DTO metatype means
// nothing to whitelist) and a sloppy or hostile client can put anything in these
// fields. Only a literal `true` turns a rule on: `"false"`, `{}`, `undefined` and
// a missing key all mean the default, so no rule is ever enabled by a truthy
// accident (the bug a `Boolean(x)` coercion would ship). No input IS the standard
// room (clash off, free exit off, safe zones ON), which is why there is no
// all-false constant for a second copy of that answer to drift away from.
export function normalizeRoomRules(input?: Partial<RoomRules> | null): RoomRules {
  return {
    clashEnabled: input?.clashEnabled === true,
    noSafeZones: input?.noSafeZones === true,
    freeExit: input?.freeExit === true,
  };
}

// Rules -> `match:*` hash fields, for the create hset. Stringified because a
// Redis hash is flat strings, and written even when false so the hash describes
// its own room: the engine's read treats an absent field as false, which is the
// same answer, and a room hash read by hand tells the truth without a default.
export function roomRuleHashFields(rules: RoomRules): Record<string, string> {
  return {
    clashEnabled: String(rules.clashEnabled),
    noSafeZones: String(rules.noSafeZones),
    freeExit: String(rules.freeExit),
  };
}

// `match:*` hash fields -> rules, for the handoff a create/rejoin hands back.
// Absent means false, so a room hash written before this port (no fields at all)
// reads as the standard game : clash off, free exit off, safe zones protecting.
export function readRoomRules(data: Record<string, string>): RoomRules {
  return {
    clashEnabled: data.clashEnabled === 'true',
    noSafeZones: data.noSafeZones === 'true',
    freeExit: data.freeExit === 'true',
  };
}
