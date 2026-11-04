import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

// The body of POST /api/friends/:friendId/invite, the one challenge path. Both
// fields are optional because the two shapes need one each: `hostColor` when the
// room has to be created (the caller is seated first, so they pick first), and
// `gameId` when the caller already sits in the waiting room the friend is being
// asked to join.
//
// A present-but-empty value is refused here rather than read as "absent": a
// mistyped `gameId` must not quietly create a second room instead of failing.
// The values themselves are checked where they are used — an unknown id is a 404
// from the room and an unknown corner fails the room's own seat rules.
export class ChallengeFriendDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  gameId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  hostColor?: string;
}