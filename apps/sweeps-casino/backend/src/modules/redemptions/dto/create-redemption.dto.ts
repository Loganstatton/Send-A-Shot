import { IsOptional, IsString, Matches } from 'class-validator';

export class CreateRedemptionDto {
  /** Positive decimal string, e.g. "25.00". */
  @IsString()
  @Matches(/^[0-9]+(\.[0-9]{1,2})?$/, { message: 'scAmount must be a positive decimal string' })
  scAmount!: string;

  @IsOptional()
  @IsString()
  payoutMethodId?: string;
}
