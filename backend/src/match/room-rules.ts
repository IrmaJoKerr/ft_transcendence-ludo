// The three room rules in one place: the wire names (`clashEnabled`, `noSafeZones`,
// `freeExit`), the `match:*` hash keys the engine reads, the defaulting rule and the
// polarity. A standard room is clash off, free exit off, safe zones on.
export type RoomRules = {
  clashEnabled: boolean;
  noSafeZones: boolean;
  freeExit: boolean;
};

// Wire to rules. The create routes read one `@Body('x')` param at a time, so the
// ValidationPipe never runs and a client can put anything in these fields. Only a
// literal `true` turns a rule on; no input is the standard room.
export function normalizeRoomRules(input?: Partial<RoomRules> | null): RoomRules {
  return {
    clashEnabled: input?.clashEnabled === true,
    noSafeZones: input?.noSafeZones === true,
    freeExit: input?.freeExit === true,
  };
}

// Rules to `match:*` hash fields, for the create hset. Stringified because a Redis
// hash is flat strings, and written even when false so the hash describes its own
// room; the engine treats an absent field as false.
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
