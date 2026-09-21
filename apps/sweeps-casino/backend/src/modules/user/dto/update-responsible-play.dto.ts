import { IsDateString, IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';

/**
 * ONLY these five fields are writable through PATCH /me/responsible-play.
 * `selfExclusionUntil` / `selfExclusionPermanent` / `selfExcludedAt` are
 * deliberately NOT properties on this DTO. The app's global ValidationPipe
 * is configured with `whitelist: true, forbidNonWhitelisted: true`
 * (see src/main.ts), so any request body that includes those fields is
 * rejected with a 400 before it ever reaches the controller/service —
 * that's the enforcement mechanism for "reject any attempt to touch
 * self-exclusion fields through this endpoint."
 *
 * Each limit field accepts `null` explicitly to clear a previously-set
 * limit (`@IsOptional()` short-circuits validation for both `undefined`
 * and `null`, so `null` passes through to the service as "clear this").
 */
export class UpdateResponsiblePlayDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,16}(\.\d{1,2})?$/, { message: 'must be a non-negative decimal amount' })
  depositLimitDaily?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,16}(\.\d{1,2})?$/, { message: 'must be a non-negative decimal amount' })
  depositLimitWeekly?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,16}(\.\d{1,2})?$/, { message: 'must be a non-negative decimal amount' })
  depositLimitMonthly?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  sessionReminderMinutes?: number | null;

  @IsOptional()
  @IsDateString()
  coolingOffUntil?: string | null;
}
