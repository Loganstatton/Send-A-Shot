import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

/**
 * Maps onto `profiles` fields. `displayName` here is `Profile.chatDisplayName`
 * (the schema has no separate top-level display name — the chat display name
 * doubles as the account's public-facing name, matching how the activity
 * feed / chat already reference it).
 */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(1, 50)
  displayName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  avatarUrl?: string;

  @IsOptional()
  @IsBoolean()
  chatAnonymized?: boolean;

  @IsOptional()
  @IsBoolean()
  marketingOptIn?: boolean;
}
