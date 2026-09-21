import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { JurisdictionStatus } from '@prisma/client';

const JURISDICTION_STATUSES: JurisdictionStatus[] = [
  'ALLOWED',
  'GC_ONLY',
  'SC_DISABLED',
  'REGISTRATION_DISABLED',
  'REDEMPTION_DISABLED',
  'BLOCKED',
];

export class PatchJurisdictionDto {
  @IsOptional()
  @IsIn(JURISDICTION_STATUSES)
  status?: JurisdictionStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  minAge?: number;

  /** Required — every compliance config change must be attributable. */
  @IsString()
  @Length(3, 1000)
  changeReason!: string;
}
