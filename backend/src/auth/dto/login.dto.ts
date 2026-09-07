import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  // Either a username or an email address : the service resolves whichever
  // one it is (usernames can't contain '@', so there's no ambiguity).
  @IsString()
  @MinLength(1)
  identifier: string;

  @IsString()
  @MinLength(1)
  password: string;
}
