import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { Currency } from '@prisma/client';

/**
 * Single DTO shared by all three Originals' /play route (the route is
 * generic over :game — see originals.controller.ts). Every game-specific
 * field is declared here (as optional) so the global ValidationPipe's
 * whitelist/forbidNonWhitelisted settings don't reject a valid dice/mines/
 * plinko body; OriginalsService then enforces which fields are actually
 * required for the given :game via outcome.dispatcher.ts's normalizeParams.
 */
export class OriginalsPlayDto {
  @IsIn(['GC', 'SC'])
  currency!: Currency;

  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'betAmount must be a positive decimal string with up to 2 decimal places.',
  })
  betAmount!: string;

  // --- dice ---
  @IsOptional()
  @IsNumber()
  @Min(2)
  @Max(98)
  target?: number;

  @IsOptional()
  @IsIn(['OVER', 'UNDER'])
  direction?: 'OVER' | 'UNDER';

  // --- mines ---
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  minesCount?: number;

  @IsOptional()
  @IsArray()
  picks?: number[];

  // --- plinko ---
  @IsOptional()
  @IsInt()
  @Min(8)
  @Max(16)
  rows?: number;

  @IsOptional()
  @IsIn(['LOW', 'MEDIUM', 'HIGH'])
  risk?: 'LOW' | 'MEDIUM' | 'HIGH';
}
