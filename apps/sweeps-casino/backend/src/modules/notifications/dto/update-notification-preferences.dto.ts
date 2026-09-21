import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, ValidateNested } from 'class-validator';

class ChannelPreferencesDto {
  @IsOptional()
  @IsBoolean()
  promotions?: boolean;

  @IsOptional()
  @IsBoolean()
  security?: boolean;

  @IsOptional()
  @IsBoolean()
  vip?: boolean;

  @IsOptional()
  @IsBoolean()
  support?: boolean;

  @IsOptional()
  @IsBoolean()
  general?: boolean;
}

/**
 * PATCH body shape: `{ [channel]: { [category]: boolean } }`, merged into
 * the existing NotificationPreferences.preferences blob (unset categories
 * are left as-is, not reset). Channels/categories are enumerated explicitly
 * (rather than accepting an arbitrary object) so the global
 * `forbidNonWhitelisted` ValidationPipe can still validate the shape.
 */
export class UpdateNotificationPreferencesDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelPreferencesDto)
  IN_APP?: ChannelPreferencesDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelPreferencesDto)
  EMAIL?: ChannelPreferencesDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelPreferencesDto)
  SMS?: ChannelPreferencesDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelPreferencesDto)
  PUSH?: ChannelPreferencesDto;
}
