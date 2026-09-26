import { IsIn, IsString, Length } from 'class-validator';

export type RedemptionDecision = 'approve' | 'reject' | 'processing' | 'paid';

const DECISIONS: RedemptionDecision[] = ['approve', 'reject', 'processing', 'paid'];

export class RedemptionDecisionDto {
  @IsIn(DECISIONS)
  decision!: RedemptionDecision;

  /** Required for every transition — each one appends a redemption_audit row. */
  @IsString()
  @Length(3, 1000)
  reason!: string;
}
