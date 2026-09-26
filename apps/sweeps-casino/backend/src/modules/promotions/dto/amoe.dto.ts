import { IsIn, IsNumberString, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { AmoeMethod } from '@prisma/client';

const AMOE_METHODS: AmoeMethod[] = ['MAIL_IN', 'WEB_FORM', 'OTHER'];

export class CreateAmoeRequestDto {
  @IsOptional()
  @IsUUID()
  promotionId?: string;

  @IsIn(AMOE_METHODS)
  method!: AmoeMethod;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  submissionRef?: string;
}

export class AdminAmoeDecisionDto {
  @IsIn(['APPROVED', 'REJECTED'])
  status!: 'APPROVED' | 'REJECTED';

  /** Required regardless of decision — every AMOE decision is audit-logged with a reason. */
  @IsString()
  @Length(3, 1000)
  reason!: string;

  /** Decimal string. Only meaningful when status=APPROVED. */
  @IsOptional()
  @IsNumberString()
  scAwarded?: string;
}
