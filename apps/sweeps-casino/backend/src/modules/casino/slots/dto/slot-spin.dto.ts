import { IsIn, IsString, Matches } from 'class-validator';
import { Currency } from '@prisma/client';

export class SlotSpinDto {
  @IsIn(['GC', 'SC'])
  currency!: Currency;

  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'betAmount must be a positive decimal string with up to 2 decimal places.',
  })
  betAmount!: string;
}
