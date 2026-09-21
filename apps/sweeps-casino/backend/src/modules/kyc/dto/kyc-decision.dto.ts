import { IsIn, IsString, Length } from 'class-validator';

export type KycDecision = 'approve' | 'reject' | 'review-required';

const DECISIONS: KycDecision[] = ['approve', 'reject', 'review-required'];

export class KycDecisionDto {
  @IsIn(DECISIONS)
  decision!: KycDecision;

  /** Required for every decision, not just rejections — this is what lands in the audit log. */
  @IsString()
  @Length(3, 1000)
  reason!: string;
}
