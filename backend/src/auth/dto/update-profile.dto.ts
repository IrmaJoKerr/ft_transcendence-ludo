import { IsString, IsEmail, IsBoolean, IsOptional, Length, Matches } from 'class-validator';

// Profile-update DTO : every field optional; only provided fields change.
// displayName: 1-30 chars; email: valid email; twoFactorEnabled toggles 2FA;
// oauthAdd/Remove: google|github|42; password change needs current + new.
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(1, 30, {
    message: 'display name must be 1-30 characters',
  })
  @Matches(/^[a-zA-Z0-9 _'-]+$/, {
    message: 'display name can only contain letters, numbers, spaces, underscores, apostrophes and hyphens',
  })
  displayName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsBoolean()
  twoFactorEnabled?: boolean;

  @IsOptional()
  @IsString()
  oauthToAdd?: string;

  @IsOptional()
  @IsString()
  oauthToRemove?: string;

  @IsOptional()
  @IsString()
  currentPassword?: string;

  @IsOptional()
  @IsString()
  newPassword?: string;
}