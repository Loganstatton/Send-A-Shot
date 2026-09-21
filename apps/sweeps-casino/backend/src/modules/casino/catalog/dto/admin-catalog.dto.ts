import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import {
  Currency,
  GameCategory,
  GameProviderStatus,
  GameProviderType,
  GameStatus,
  Volatility,
} from '@prisma/client';

export class AdminCreateGameDto {
  @IsString() providerId!: string;

  @IsString() providerGameId!: string;

  @IsString() name!: string;

  @IsString() slug!: string;

  @IsIn(['ORIGINALS', 'SLOTS', 'LIVE_CASINO', 'TABLE_GAMES', 'GAME_SHOWS'])
  category!: GameCategory;

  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];

  @IsOptional() @IsString() imageUrl?: string;

  @IsOptional() @IsArray() @IsIn(['GC', 'SC'], { each: true }) supportedCurrencies?: Currency[];

  @IsOptional() @IsBoolean() demoAvailable?: boolean;

  @IsOptional() @IsInt() rtpBps?: number;

  @IsOptional() @IsIn(['LOW', 'MEDIUM', 'HIGH']) volatility?: Volatility;

  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE', 'MAINTENANCE']) status?: GameStatus;

  @IsOptional() @IsArray() @IsString({ each: true }) restrictedJurisdictions?: string[];

  @IsOptional() @IsInt() sortWeight?: number;
}

export class AdminUpdateGameDto {
  @IsOptional() @IsString() name?: string;

  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];

  @IsOptional() @IsString() imageUrl?: string;

  @IsOptional() @IsArray() @IsIn(['GC', 'SC'], { each: true }) supportedCurrencies?: Currency[];

  @IsOptional() @IsBoolean() demoAvailable?: boolean;

  @IsOptional() @IsInt() rtpBps?: number;

  @IsOptional() @IsIn(['LOW', 'MEDIUM', 'HIGH']) volatility?: Volatility;

  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE', 'MAINTENANCE']) status?: GameStatus;

  @IsOptional() @IsArray() @IsString({ each: true }) restrictedJurisdictions?: string[];

  @IsOptional() @IsInt() sortWeight?: number;
}

export class AdminCreateGameProviderDto {
  @IsString() code!: string;

  @IsString() name!: string;

  @IsIn(['INTERNAL', 'AGGREGATOR', 'LIVE_DEALER'])
  type!: GameProviderType;

  @IsOptional() @IsIn(['ACTIVE', 'MAINTENANCE', 'DISABLED']) status?: GameProviderStatus;
}

export class AdminUpdateGameProviderDto {
  @IsOptional() @IsString() name?: string;

  @IsOptional() @IsIn(['ACTIVE', 'MAINTENANCE', 'DISABLED']) status?: GameProviderStatus;
}
