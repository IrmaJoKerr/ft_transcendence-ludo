import { IsString, MinLength, MaxLength, IsEmail, Matches } from 'class-validator';
import { PASSWORD_MIN, PASSWORD_MAX, PASSWORD_REGEX, PASSWORD_MESSAGE } from './password.rules';

export class RegisterDto {
  // Immutable account name: 3-20 chars, letters/numbers/underscore only.
  @IsString()
  @Matches(/^[a-zA-Z0-9_]{3,20}$/, {
    message: 'username must be 3-20 characters: letters, numbers, underscore only',
  })
  username: string;

  // Required: signup verification and login 2FA codes are both delivered here.
  @IsEmail()
  email: string;

  // Login password; strength rules live in password.rules.ts.
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  @Matches(PASSWORD_REGEX, { message: PASSWORD_MESSAGE })
  password: string;
}
