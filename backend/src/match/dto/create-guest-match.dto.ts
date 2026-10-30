import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const COLORS = ['blue', 'red', 'green', 'yellow'];

// The guest setup screen's create body. This route takes a DTO class, so every rule
// fails at the HTTP boundary before any Redis key is written. Deliberately absent:
// `mode`, `playerCount`, `seatColors` and `gameId`.
export class CreateGuestMatchDto {
  // Required, not optional: a guest has no session to default against and a
  // bot-less "PvE" room is meaningless. 1-3 mirrors createMatch's PvE checks
  // (playerCount 2-4) and the four-colour seat table.
  @IsInt()
  @Min(1)
  @Max(3)
  botCount!: number;

  // Index-aligned with botNames, and the same invariants createMatch enforces:
  // no duplicate colours, colours from the four.
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(3)
  @IsIn(COLORS, { each: true })
  botColors?: string[];

  // Display labels only; the bot's identity stays `bot-<color>`. 20 is the cap
  // botLabel applies (`replace(/[()]/g, '').trim().slice(0, 20)`).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  botNames?: string[];

  // The room rules, frozen at creation (the engine reads them from the match
  // hash). Same wire names as /api/match/create; room-rules.ts normalizes and
  // defaults them, and only a literal `true` enables one.
  @IsOptional()
  @IsBoolean()
  clashEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  noSafeZones?: boolean;

  @IsOptional()
  @IsBoolean()
  freeExit?: boolean;

  // Key-shift mutator: 0 off, 1 or 2 switches. Validated here because this route
  // takes a DTO class; the other create routes rely on room-rules.ts's clamp, which
  // also forces 0 whenever clash mode is off.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2)
  clashKeyShift?: 0 | 1 | 2;
}
