import { IsOptional, IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { PASSWORD_MIN, PASSWORD_MAX, PASSWORD_REGEX, PASSWORD_MESSAGE } from './password.rules';

// Logged-in password change. `currentPassword` is required unless the account
// is OAuth-only (no existing password) : the service enforces this per account.
export class ChangePasswordDto {
  @IsOptional()
  @IsString()
  currentPassword?: string;

  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  @Matches(PASSWORD_REGEX, { message: PASSWORD_MESSAGE })
  newPassword: string;
}