import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Exactly one of `durationDays` / `permanent` must be provided — enforced
 * in UserService.selfExclude (a cross-field XOR isn't expressible cleanly
 * with class-validator alone, so it's checked in the service where the
 * error message can be specific).
 */
export class SelfExcludeDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  durationDays?: number;

  @IsOptional()
  @IsBoolean()
  permanent?: boolean;
}
