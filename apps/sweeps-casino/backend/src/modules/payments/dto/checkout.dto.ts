import { IsOptional, IsString } from 'class-validator';

export class CheckoutDto {
  @IsString()
  gcPackageId!: string;

  @IsOptional()
  @IsString()
  paymentMethodId?: string;
}
