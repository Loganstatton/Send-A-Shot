import { IsInt, IsNumberString, IsObject, IsOptional, IsString, Min } from 'class-validator';

export class CreateVipLevelDto {
  @IsInt()
  @Min(0)
  rankOrder!: number;

  @IsString()
  name!: string;

  /** Decimal(18,2) string, e.g. "1000.00". */
  @IsNumberString()
  minPoints!: string;

  /** Decimal(10,4) string, e.g. "1.0000". Defaults to 1x in the schema. */
  @IsOptional()
  @IsNumberString()
  gcPointsMultiplier?: string;

  @IsOptional()
  @IsNumberString()
  scPointsMultiplier?: string;

  @IsOptional()
  @IsObject()
  benefits?: Record<string, unknown>;

  /** e.g. { currency: 'GC' | 'SC', amount: '10.00' } — granted once on promotion into this level. */
  @IsOptional()
  @IsObject()
  rankUpReward?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  weeklyReward?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  monthlyReward?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  rakebackBps?: number;
}

export class UpdateVipLevelDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  rankOrder?: number;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumberString()
  minPoints?: string;

  @IsOptional()
  @IsNumberString()
  gcPointsMultiplier?: string;

  @IsOptional()
  @IsNumberString()
  scPointsMultiplier?: string;

  @IsOptional()
  @IsObject()
  benefits?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  rankUpReward?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  weeklyReward?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  monthlyReward?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  rakebackBps?: number;
}
