import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class TwoFactorSettingDto {
  // true = require an email code at every login; false = skip it.
  @IsBoolean()
  enabled!: boolean;

  // Re-auth for the toggle on a password account (ignored for OAuth-only).
  @IsOptional()
  @IsString()
  currentPassword?: string;
}
