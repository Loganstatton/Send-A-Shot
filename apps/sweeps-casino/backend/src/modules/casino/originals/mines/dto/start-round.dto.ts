import { IsIn, IsInt, IsString, Matches, Max, Min } from 'class-validator';
import { Currency } from '@prisma/client';

/** POST /casino/originals/mines/start body. */
export class StartMinesRoundDto {
  @IsIn(['GC', 'SC'])
  currency!: Currency;

  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'betAmount must be a positive decimal string with up to 2 decimal places.',
  })
  betAmount!: string;

  @IsInt()
  @Min(1)
  @Max(24)
  minesCount!: number;
}
