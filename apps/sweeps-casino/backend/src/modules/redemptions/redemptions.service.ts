import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { RedemptionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { RiskService } from '../risk/risk.service';
import { ComplianceService } from '../compliance/compliance.service';
import { FeatureFlagService } from '../compliance/feature-flag.service';
import { CreateRedemptionDto } from './dto/create-redemption.dto';
import { RedemptionDecisionDto } from './dto/redemption-decision.dto';
import { toCents } from '../../libs/money/money';

const DECISION_TO_STATUS: Record<string, RedemptionStatus> = {
  approve: 'APPROVED',
  reject: 'REJECTED',
  processing: 'PROCESSING',
  paid: 'PAID',
};

export interface RedemptionEligibility {
  flagEnabled: boolean;
  kycVerified: boolean;
  jurisdictionAllowed: boolean;
  sufficientScBalance: boolean;
  blockingReason: string | null;
}

@Injectable()
export class RedemptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly riskService: RiskService,
    private readonly complianceService: ComplianceService,
    private readonly featureFlagService: FeatureFlagService,
  ) {}

  /**
   * Never flag-gated (see RedemptionsController) — its whole job is to
   * explain state even when redemptions.enabled=false, so it always
   * computes every field directly rather than throwing on the first
   * failing check.
   */
  async getEligibility(userId: string, requestedAmount?: string): Promise<RedemptionEligibility> {
    const [flagEnabled, user, wallets] = await Promise.all([
      this.featureFlagService.isEnabled('redemptions.enabled'),
      this.prisma.user.findUnique({ where: { id: userId }, select: { kycStatus: true, stateOfRecord: true } }),
      this.walletService.getWallets(userId),
    ]);

    const kycVerified = user?.kycStatus === 'VERIFIED';

    const jurisdictionStatus = await this.complianceService.getJurisdictionStatusForState(
      user?.stateOfRecord ?? undefined,
    );
    const jurisdictionAllowed = jurisdictionStatus.capabilities.redemption;

    const scBalanceCents = toCents(wallets.sc.balance);
    const thresholdCents = requestedAmount ? toCents(requestedAmount) : 1n; // any positive balance counts as "sufficient" absent a specific request
    const sufficientScBalance = scBalanceCents > 0n && scBalanceCents >= thresholdCents;

    let blockingReason: string | null = null;
    if (!flagEnabled) blockingReason = 'FEATURE_DISABLED';
    else if (!kycVerified) blockingReason = 'KYC_NOT_VERIFIED';
    else if (!jurisdictionAllowed) blockingReason = 'JURISDICTION_RESTRICTED';
    else if (!sufficientScBalance) blockingReason = 'INSUFFICIENT_SC_BALANCE';

    return { flagEnabled, kycVerified, jurisdictionAllowed, sufficientScBalance, blockingReason };
  }

  /**
   * FeatureFlagGuard + JurisdictionGuard already covered the flag and
   * jurisdiction checks before this runs (see RedemptionsController); this
   * runs KYC then risk, in that order, matching docs/05-api-design.md's
   * "eligibility → jurisdiction → KYC → risk" sequence.
   */
  async create(userId: string, dto: CreateRedemptionDto) {
    if (toCents(dto.scAmount) <= 0n) {
      throw new BadRequestException({ code: 'INVALID_AMOUNT', message: 'scAmount must be greater than zero.' });
    }

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    if (user.kycStatus !== 'VERIFIED') {
      throw new ForbiddenException({
        code: 'KYC_NOT_VERIFIED',
        message: 'KYC verification is required before redeeming.',
      });
    }

    if (dto.payoutMethodId) {
      const method = await this.prisma.paymentMethod.findFirst({
        where: { id: dto.payoutMethodId, userId, status: 'ACTIVE' },
      });
      if (!method) {
        throw new BadRequestException({
          code: 'INVALID_PAYOUT_METHOD',
          message: 'Payout method not found or inactive.',
        });
      }
    }

    const riskResult = await this.riskService.evaluate(userId, { context: 'redemption', scAmount: dto.scAmount });
    if (riskResult.outcome !== 'PASS') {
      throw new ForbiddenException({
        code: 'RISK_CHECK_FAILED',
        message: `Redemption blocked by risk review (${riskResult.outcome}).`,
      });
    }

    const jurisdictionStatus = await this.complianceService.getJurisdictionStatusForState(
      user.stateOfRecord ?? undefined,
    );

    const eligibilitySnapshot = {
      kycStatus: user.kycStatus,
      jurisdictionState: user.stateOfRecord,
      jurisdictionStatus: jurisdictionStatus.status,
      riskOutcome: riskResult.outcome,
      checkedAt: new Date().toISOString(),
    };

    const redemption = await this.prisma.redemption.create({
      data: {
        userId,
        status: 'PENDING',
        scAmount: dto.scAmount,
        payoutMethodId: dto.payoutMethodId,
        eligibilitySnapshot,
      },
    });

    try {
      await this.walletService.postEntries(userId, 'SC', [
        {
          type: 'REDEMPTION_HOLD',
          amount: `-${dto.scAmount}`,
          source: 'REDEMPTION',
          idempotencyKey: `redemption-hold:${redemption.id}`,
          redemptionId: redemption.id,
        },
      ]);
    } catch (err) {
      // No balance was ever moved (postEntries threw before committing), so
      // the DRAFT-ish PENDING row we just created is dangling — remove it
      // rather than leaving an orphaned redemption with no hold behind it.
      await this.prisma.redemption.delete({ where: { id: redemption.id } });
      throw err;
    }

    return redemption;
  }

  async list(userId: string) {
    return this.prisma.redemption.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  async getOwn(userId: string, id: string) {
    const redemption = await this.prisma.redemption.findFirst({
      where: { id, userId },
      include: { auditTrail: { orderBy: { createdAt: 'asc' } } },
    });
    if (!redemption) {
      throw new NotFoundException({ code: 'REDEMPTION_NOT_FOUND', message: 'Redemption not found.' });
    }
    return redemption;
  }

  async cancel(userId: string, id: string) {
    const redemption = await this.prisma.redemption.findFirst({ where: { id, userId } });
    if (!redemption) {
      throw new NotFoundException({ code: 'REDEMPTION_NOT_FOUND', message: 'Redemption not found.' });
    }
    if (redemption.status !== 'PENDING') {
      throw new BadRequestException({
        code: 'REDEMPTION_NOT_CANCELLABLE',
        message: 'Only PENDING redemptions can be cancelled.',
      });
    }

    await this.walletService.postEntries(userId, 'SC', [
      {
        type: 'REDEMPTION_REVERSAL',
        amount: redemption.scAmount.toString(),
        source: 'REDEMPTION',
        idempotencyKey: `redemption-reversal:${redemption.id}`,
        redemptionId: redemption.id,
      },
    ]);

    return this.prisma.$transaction(async (tx) => {
      const rec = await tx.redemption.update({ where: { id }, data: { status: 'CANCELLED' } });
      await tx.redemptionAudit.create({
        data: { redemptionId: id, fromStatus: 'PENDING', toStatus: 'CANCELLED', actorId: userId, reason: 'Cancelled by user' },
      });
      return rec;
    });
  }

  async adminList(status?: RedemptionStatus) {
    return this.prisma.redemption.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async decide(id: string, dto: RedemptionDecisionDto, adminId: string) {
    const redemption = await this.prisma.redemption.findUnique({ where: { id } });
    if (!redemption) {
      throw new NotFoundException({ code: 'REDEMPTION_NOT_FOUND', message: 'Redemption not found.' });
    }

    const toStatus = DECISION_TO_STATUS[dto.decision];
    const fromStatus = redemption.status;

    if (toStatus === 'REJECTED') {
      // The SC hold was placed (as a negative REDEMPTION_HOLD entry) when
      // the redemption was created; rejecting it returns those funds to
      // the player's spendable balance via a REDEMPTION_REVERSAL entry.
      await this.walletService.postEntries(redemption.userId, 'SC', [
        {
          type: 'REDEMPTION_REVERSAL',
          amount: redemption.scAmount.toString(),
          source: 'REDEMPTION',
          idempotencyKey: `redemption-reversal:${redemption.id}`,
          redemptionId: redemption.id,
        },
      ]);
    }

    // PAID is a pure status transition + audit row: no ledger entry is
    // posted here. The SC already left the player's spendable balance at
    // hold time (the REDEMPTION_HOLD entry posted in create()); marking a
    // redemption PAID records that the off-platform payout was fulfilled,
    // it doesn't move any more platform-ledger SC. There is deliberately
    // no REDEMPTION_PAYOUT credit back to the player here.

    return this.prisma.$transaction(async (tx) => {
      const rec = await tx.redemption.update({
        where: { id },
        data: {
          status: toStatus,
          decidedBy: adminId,
          decidedAt: toStatus === 'APPROVED' || toStatus === 'REJECTED' ? new Date() : redemption.decidedAt,
          paidAt: toStatus === 'PAID' ? new Date() : redemption.paidAt,
        },
      });
      await tx.redemptionAudit.create({
        data: { redemptionId: id, fromStatus, toStatus, actorId: adminId, reason: dto.reason },
      });
      return rec;
    });
  }
}
