import { IsBoolean, IsObject, IsOptional, IsString, Length } from 'class-validator';

export class PatchFeatureFlagDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsObject()
  rolloutMeta?: Record<string, unknown>;

  /** Required — every compliance config change must be attributable. */
  @IsString()
  @Length(3, 1000)
  changeReason!: string;
}
