import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class DeleteAccountDto {
  // Password verification for the deletion. OAuth-only accounts (no
  // password_hash) must set a first password via changePassword before they
  // can delete : so in practice this is always required at deletion time.
  @IsOptional()
  @IsString()
  currentPassword?: string;

  // Explicit acknowledgement that the account and all data will be deleted.
  @IsBoolean()
  confirm: boolean;
}
