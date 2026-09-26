import { Injectable } from '@nestjs/common';
import { Prisma, RiskOutcome } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface RiskEvaluationResult {
  outcome: RiskOutcome;
}

/**
 * Phase 1 has no automated rule engine yet — evaluating risk_rules against
 * live signals is a Phase 2 item (docs/06-phase1-plan.md). `evaluate()` is
 * the stable public interface every caller (redemptions today; payments,
 * casino later) depends on, and it always PASSes for now. The body is
 * structured so a real rule-evaluation loop over active RiskRule rows can
 * replace `runRules()` without any caller needing to change.
 *
 * Per docs/02-database-schema.md §Risk: automated outcomes never
 * delete/freeze a balance directly. A BLOCK outcome here only ever writes a
 * risk_events row for an admin to review — flipping users.status is a
 * separate, explicit, audited admin action outside RISK's concern.
 */
@Injectable()
export class RiskService {
  constructor(private readonly prisma: PrismaService) {}

  async evaluate(userId: string, context: Record<string, unknown>): Promise<RiskEvaluationResult> {
    const outcome = await this.runRules(userId, context);

    if (outcome !== 'PASS') {
      await this.prisma.riskEvent.create({
        data: {
          userId,
          signalType: typeof context.context === 'string' ? context.context : 'unknown',
          severity: outcome === 'BLOCK' ? 'HIGH' : 'MEDIUM',
          outcome,
          details: context as unknown as Prisma.InputJsonValue,
        },
      });
    }

    return { outcome };
  }

  private async runRules(_userId: string, _context: Record<string, unknown>): Promise<RiskOutcome> {
    // Phase 2 TODO: SELECT * FROM risk_rules WHERE active ORDER BY ...,
    // evaluate each rule's `condition` against signals derived from
    // (userId, context), and return the most severe outcome encountered
    // (BLOCK > LIMIT > REVIEW > PASS). Never automatically mutate a
    // balance or users.status from this method.
    return 'PASS';
  }
}
