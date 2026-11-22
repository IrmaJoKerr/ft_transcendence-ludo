import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

// Body for both send routes: `hostColor` for a challenge, `gameId` for a room invite.
// Both are optional because one DTO serves both; each route rejects an empty value
// rather than reading it as absent. Values are checked where they are used.
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