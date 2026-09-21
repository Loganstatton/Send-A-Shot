import { IsOptional, IsString, Length } from 'class-validator';

export class RotateSeedDto {
  @IsOptional()
  @IsString()
  @Length(1, 128)
  newClientSeed?: string;
}

export class UpdateClientSeedDto {
  @IsString()
  @Length(1, 128)
  clientSeed!: string;
}
