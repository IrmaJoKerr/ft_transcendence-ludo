import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

// The body of the two send routes (19.6), one field each. Both fields are optional in
// the type because one DTO serves both: `hostColor` belongs to
// POST /api/friends/:friendId/challenge (the corner the challenger will host in once
// the duel exists) and `gameId` to POST /api/friends/:friendId/invite (the waiting
// room whose free seat is being offered).
//
// A present-but-empty value is refused here rather than read as "absent": a mistyped
// `gameId` must not quietly read as a challenge, and each route refuses its own field
// when it is missing. The values themselves are checked where they are used — an
// unknown id is a 404 from the room and an unknown corner fails the room's own seat
// rules at the accept.
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