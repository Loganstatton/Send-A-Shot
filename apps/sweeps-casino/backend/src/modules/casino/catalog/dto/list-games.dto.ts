import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { GameCategory } from '@prisma/client';

export type CatalogSort = 'featured' | 'new' | 'name';

export class ListGamesQueryDto {
  @IsOptional()
  @IsIn(['ORIGINALS', 'SLOTS', 'LIVE_CASINO', 'TABLE_GAMES', 'GAME_SHOWS'])
  category?: GameCategory;

  /** GameProvider.code, e.g. "internal-originals". */
  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  tag?: string;

  @IsOptional()
  @IsIn(['featured', 'new', 'name'])
  sort?: CatalogSort;

  @IsOptional()
  @IsString()
  cursor?: string;

  /** ILIKE search against Game.name. */
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
