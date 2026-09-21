import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';
import { PromotionCurrency, PromotionStatus, PromotionType } from '@prisma/client';

const PROMOTION_TYPES: PromotionType[] = [
  'SIGNUP',
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'LEADERBOARD',
  'RAFFLE',
  'CHALLENGE',
  'GAME_SPECIFIC',
  'PROVIDER',
  'PROMO_CODE',
  'PURCHASE',
  'SOCIAL',
  'MANUAL',
];
const PROMOTION_STATUSES: PromotionStatus[] = ['DRAFT', 'ACTIVE', 'PAUSED', 'ENDED'];
const PROMOTION_CURRENCIES: PromotionCurrency[] = ['GC', 'SC', 'BOTH'];

export class CreatePromotionDto {
  @IsIn(PROMOTION_TYPES)
  type!: PromotionType;

  @IsString()
  @Length(1, 200)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  termsUrl?: string;

  @IsOptional()
  @IsIn(PROMOTION_STATUSES)
  status?: PromotionStatus;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  jurisdictionAllowlist?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  minAccountAgeDays?: number;

  @IsOptional()
  @IsBoolean()
  requiresKyc?: boolean;

  @IsOptional()
  @IsUUID()
  minVipLevelId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  eligibleGameIds?: string[];

  @IsOptional()
  @IsIn(PROMOTION_CURRENCIES)
  eligibleCurrency?: PromotionCurrency;

  /** Generic reward shape — see src/modules/promotions/lib/reward-config.ts */
  @IsObject()
  rewardConfig!: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  playthroughRequirement?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(1)
  claimLimitPerUser?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxParticipants?: number;
}

export class UpdatePromotionDto {
  @IsOptional()
  @IsIn(PROMOTION_TYPES)
  type?: PromotionType;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  termsUrl?: string;

  @IsOptional()
  @IsIn(PROMOTION_STATUSES)
  status?: PromotionStatus;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  jurisdictionAllowlist?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  minAccountAgeDays?: number;

  @IsOptional()
  @IsBoolean()
  requiresKyc?: boolean;

  @IsOptional()
  @IsUUID()
  minVipLevelId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  eligibleGameIds?: string[];

  @IsOptional()
  @IsIn(PROMOTION_CURRENCIES)
  eligibleCurrency?: PromotionCurrency;

  @IsOptional()
  @IsObject()
  rewardConfig?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  playthroughRequirement?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(1)
  claimLimitPerUser?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxParticipants?: number;
}

export class RedeemCodeDto {
  @IsString()
  @Length(1, 64)
  code!: string;
}
