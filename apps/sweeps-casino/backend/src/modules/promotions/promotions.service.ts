import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AmoeMethod,
  AmoeStatus,
  LedgerEntryType,
  Prisma,
  Promotion,
  PromotionClaim,
  PromotionStatus,
  PromotionType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { VipService } from '../vip/vip.service';
import { isPositive } from '../../libs/money/money';
import { checkEligibility } from './lib/eligibility';
import { resolveReward, RewardGrant } from './lib/reward-config';
import { AlreadyClaimedError, computeNextStreakDay } from './lib/daily-bonus';
import { CreatePromotionDto, UpdatePromotionDto } from './dto/promotion.dto';
import { AdminAmoeDecisionDto, CreateAmoeRequestDto } from './dto/amoe.dto';

const SC_ISSUANCE_FLAG = 'sc.promotional_issuance_enabled';

function ledgerTypeForPromotion(type: PromotionType): LedgerEntryType {
  return type === 'DAILY' ? 'DAILY_BONUS' : 'PROMO_GRANT';
}

@Injectable()
export class PromotionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly vipService: VipService,
  ) {}

  // ── Player-facing ──────────────────────────────────────────────────────

  async listForUser(userId: string, filters: { type?: PromotionType }) {
    const now = new Date();
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const userVipRankOrder = await this.vipService.getUserRankOrder(userId).catch(() => null);

    // Player-facing listing is always constrained to ACTIVE + eligible; a
    // `status` query param other than "active" has no further meaning here
    // (there's no player-facing view of DRAFT/PAUSED/ENDED promotions).
    const promotions = await this.prisma.promotion.findMany({
      where: {
        status: 'ACTIVE',
        ...(filters.type ? { type: filters.type } : {}),
      },
      include: { minVipLevel: true },
      orderBy: { createdAt: 'desc' },
    });

    return promotions
      .filter((p) => {
        const requiredVipRankOrder = p.minVipLevel?.rankOrder ?? null;
        return checkEligibility(user, p, now, userVipRankOrder, requiredVipRankOrder).eligible;
      })
      .map((p) => this.toPublicPromotion(p));
  }

  async getById(id: string) {
    const promotion = await this.prisma.promotion.findUnique({ where: { id } });
    if (!promotion) {
      throw new NotFoundException({ code: 'PROMOTION_NOT_FOUND', message: 'Promotion not found.' });
    }
    return this.toPublicPromotion(promotion);
  }

  async claimPromotionById(userId: string, promotionId: string) {
    const promotion = await this.prisma.promotion.findUnique({ where: { id: promotionId } });
    if (!promotion) {
      throw new NotFoundException({ code: 'PROMOTION_NOT_FOUND', message: 'Promotion not found.' });
    }
    const { claim, grants } = await this.performClaim(userId, promotion);
    return this.claimResponse(claim, grants);
  }

  private async getDailyBonusPromotion(): Promise<Promotion> {
    const promotion = await this.prisma.promotion.findFirst({
      where: { type: 'DAILY', status: 'ACTIVE' },
    });
    if (!promotion) {
      throw new NotFoundException({
        code: 'DAILY_BONUS_NOT_CONFIGURED',
        message: 'No active daily bonus promotion is configured.',
      });
    }
    return promotion;
  }

  private extractDay(claim: PromotionClaim): number | null {
    const progress = claim.playthroughProgress as { day?: number } | null;
    return progress?.day ?? null;
  }

  private async lastDailyBonusClaim(promotionId: string, userId: string) {
    return this.prisma.promotionClaim.findFirst({
      where: { promotionId, userId },
      orderBy: { claimedAt: 'desc' },
    });
  }

  async getDailyBonusState(userId: string) {
    const promotion = await this.getDailyBonusPromotion();
    const lastClaim = await this.lastDailyBonusClaim(promotion.id, userId);
    const lastDay = lastClaim ? this.extractDay(lastClaim) : null;
    const cooldownHours = resolveReward(promotion.rewardConfig).cooldownHours ?? 24;

    let day: number;
    let claimableNow = true;
    let hoursRemaining = 0;

    try {
      day = computeNextStreakDay(lastClaim?.claimedAt ?? null, lastDay, new Date(), cooldownHours);
    } catch (err) {
      if (err instanceof AlreadyClaimedError) {
        claimableNow = false;
        hoursRemaining = Math.round(err.hoursRemaining * 10) / 10;
        day = lastDay ?? 1;
      } else {
        throw err;
      }
    }

    const resolved = resolveReward(promotion.rewardConfig, day);

    return {
      promotionId: promotion.id,
      day,
      claimableNow,
      hoursRemaining,
      reward: resolved.grants,
      cooldownHours,
    };
  }

  async claimDailyBonus(userId: string) {
    const promotion = await this.getDailyBonusPromotion();
    const lastClaim = await this.lastDailyBonusClaim(promotion.id, userId);
    const lastDay = lastClaim ? this.extractDay(lastClaim) : null;
    const cooldownHours = resolveReward(promotion.rewardConfig).cooldownHours ?? 24;

    let day: number;
    try {
      day = computeNextStreakDay(lastClaim?.claimedAt ?? null, lastDay, new Date(), cooldownHours);
    } catch (err) {
      if (err instanceof AlreadyClaimedError) {
        throw new ConflictException({ code: 'ALREADY_CLAIMED', message: err.message });
      }
      throw err;
    }

    const { claim, grants } = await this.performClaim(userId, promotion, { day });
    return this.claimResponse(claim, grants);
  }

  async redeemCode(userId: string, rawCode: string) {
    const code = rawCode.trim().toUpperCase();
    const promotion = await this.prisma.promotion.findFirst({
      where: {
        type: 'PROMO_CODE',
        status: 'ACTIVE',
        rewardConfig: { path: ['code'], equals: code },
      },
    });
    if (!promotion) {
      throw new NotFoundException({ code: 'PROMO_CODE_NOT_FOUND', message: 'Invalid or expired promo code.' });
    }
    const { claim, grants } = await this.performClaim(userId, promotion);
    return this.claimResponse(claim, grants);
  }

  async listClaims(userId: string) {
    return this.prisma.promotionClaim.findMany({
      where: { userId },
      orderBy: { claimedAt: 'desc' },
      include: { promotion: { select: { id: true, name: true, type: true } } },
    });
  }

  // ── Shared claim engine ────────────────────────────────────────────────

  /**
   * Validates eligibility, resolves the reward from `rewardConfig`, creates
   * the PromotionClaim row (inside a transaction, closing the
   * claimSequence/maxParticipants race via the unique constraint), then
   * posts the grant(s) via WalletService.postEntries referencing that
   * claim. The claim row is created before the wallet call per the task
   * design — if the process dies between the two steps, the claim exists
   * without a ledger entry; the deterministic idempotencyKey
   * (`promo:{promotionId}:{userId}:{claimSequence}`) makes it safe to
   * re-post on retry without double-granting.
   */
  private async performClaim(
    userId: string,
    promotion: Promotion,
    opts?: { day?: number },
  ): Promise<{ claim: PromotionClaim; grants: RewardGrant[] }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const requiredVipRankOrder = promotion.minVipLevelId
      ? ((await this.prisma.vipLevel.findUnique({ where: { id: promotion.minVipLevelId } }))
          ?.rankOrder ?? null)
      : null;
    const userVipRankOrder = await this.vipService.getUserRankOrder(userId).catch(() => null);

    const eligibility = checkEligibility(
      user,
      promotion,
      new Date(),
      userVipRankOrder,
      requiredVipRankOrder,
    );
    if (!eligibility.eligible) {
      throw new ForbiddenException({ code: 'PROMOTION_NOT_ELIGIBLE', message: eligibility.reason });
    }

    const resolved = resolveReward(promotion.rewardConfig, opts?.day);
    if (resolved.grants.length === 0) {
      throw new BadRequestException({
        code: 'NOTHING_TO_CLAIM',
        message: 'This promotion has no reward configured for this claim.',
      });
    }

    const requiresScFlag = resolved.grants.some((g) => g.currency === 'SC');
    if (requiresScFlag) {
      const flag = await this.prisma.featureFlag.findUnique({ where: { key: SC_ISSUANCE_FLAG } });
      if (!flag?.enabled) {
        throw new ForbiddenException({
          code: 'FEATURE_DISABLED',
          message: 'SC promotional issuance is not yet enabled on this platform.',
        });
      }
    }

    let claim: PromotionClaim;
    try {
      claim = await this.prisma.$transaction(async (tx) => {
        const claimSequence = (await tx.promotionClaim.count({
          where: { promotionId: promotion.id, userId },
        })) + 1;

        if (promotion.claimLimitPerUser != null && claimSequence > promotion.claimLimitPerUser) {
          throw new ConflictException({
            code: 'CLAIM_LIMIT_REACHED',
            message: 'You have already claimed this promotion the maximum number of times.',
          });
        }

        if (promotion.maxParticipants != null) {
          // Best-effort check; the unique (promotionId, userId, claimSequence)
          // constraint below is what actually closes the race under concurrency.
          const totalClaims = await tx.promotionClaim.count({ where: { promotionId: promotion.id } });
          if (totalClaims >= promotion.maxParticipants) {
            throw new ConflictException({
              code: 'PROMOTION_FULL',
              message: 'This promotion has reached its participant limit.',
            });
          }
        }

        const primaryGrant = resolved.grants[0];
        return tx.promotionClaim.create({
          data: {
            promotionId: promotion.id,
            userId,
            claimSequence,
            status: 'GRANTED',
            grantedAmount: primaryGrant.amount,
            currency: primaryGrant.currency,
            playthroughProgress: opts?.day != null ? { day: opts.day } : Prisma.JsonNull,
          },
        });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          code: 'CLAIM_LIMIT_REACHED',
          message: 'This claim was already recorded.',
        });
      }
      throw err;
    }

    const ledgerType = ledgerTypeForPromotion(promotion.type);
    for (const grant of resolved.grants) {
      await this.walletService.postEntries(userId, grant.currency, [
        {
          type: ledgerType,
          amount: grant.amount,
          source: 'PROMOTION',
          idempotencyKey: `promo:${promotion.id}:${userId}:${claim.claimSequence}`,
          promotionClaimId: claim.id,
          metadata: { promotionId: promotion.id, promotionType: promotion.type, day: opts?.day },
        },
      ]);
    }

    return { claim, grants: resolved.grants };
  }

  private claimResponse(claim: PromotionClaim, grants: RewardGrant[]) {
    return { claim, grants };
  }

  private toPublicPromotion(promotion: Promotion) {
    return promotion;
  }

  // ── AMOE ────────────────────────────────────────────────────────────────

  async createAmoeRequest(userId: string, dto: CreateAmoeRequestDto) {
    return this.prisma.amoeRequest.create({
      data: {
        userId,
        promotionId: dto.promotionId,
        method: dto.method as AmoeMethod,
        submissionRef: dto.submissionRef,
      },
    });
  }

  async listAmoeRequests(userId: string) {
    return this.prisma.amoeRequest.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  // ── Admin: Promotions CRUD ────────────────────────────────────────────

  async listAdmin(filters: { type?: PromotionType; status?: string }) {
    return this.prisma.promotion.findMany({
      where: {
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.status ? { status: filters.status as PromotionStatus } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAdmin(id: string) {
    const promotion = await this.prisma.promotion.findUnique({ where: { id } });
    if (!promotion) {
      throw new NotFoundException({ code: 'PROMOTION_NOT_FOUND', message: 'Promotion not found.' });
    }
    return promotion;
  }

  async createAdmin(dto: CreatePromotionDto, adminId: string) {
    return this.prisma.promotion.create({
      data: {
        type: dto.type,
        name: dto.name,
        description: dto.description,
        termsUrl: dto.termsUrl,
        status: dto.status,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
        jurisdictionAllowlist: dto.jurisdictionAllowlist ?? [],
        minAccountAgeDays: dto.minAccountAgeDays,
        requiresKyc: dto.requiresKyc,
        minVipLevelId: dto.minVipLevelId,
        eligibleGameIds: dto.eligibleGameIds ?? [],
        eligibleCurrency: dto.eligibleCurrency,
        rewardConfig: dto.rewardConfig as Prisma.InputJsonValue,
        playthroughRequirement: dto.playthroughRequirement as Prisma.InputJsonValue,
        claimLimitPerUser: dto.claimLimitPerUser,
        maxParticipants: dto.maxParticipants,
        createdBy: adminId,
      },
    });
  }

  async updateAdmin(id: string, dto: UpdatePromotionDto) {
    await this.getAdmin(id);
    return this.prisma.promotion.update({
      where: { id },
      data: {
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.termsUrl !== undefined ? { termsUrl: dto.termsUrl } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.startsAt !== undefined ? { startsAt: new Date(dto.startsAt) } : {}),
        ...(dto.endsAt !== undefined ? { endsAt: new Date(dto.endsAt) } : {}),
        ...(dto.jurisdictionAllowlist !== undefined
          ? { jurisdictionAllowlist: dto.jurisdictionAllowlist }
          : {}),
        ...(dto.minAccountAgeDays !== undefined ? { minAccountAgeDays: dto.minAccountAgeDays } : {}),
        ...(dto.requiresKyc !== undefined ? { requiresKyc: dto.requiresKyc } : {}),
        ...(dto.minVipLevelId !== undefined ? { minVipLevelId: dto.minVipLevelId } : {}),
        ...(dto.eligibleGameIds !== undefined ? { eligibleGameIds: dto.eligibleGameIds } : {}),
        ...(dto.eligibleCurrency !== undefined ? { eligibleCurrency: dto.eligibleCurrency } : {}),
        ...(dto.rewardConfig !== undefined
          ? { rewardConfig: dto.rewardConfig as Prisma.InputJsonValue }
          : {}),
        ...(dto.playthroughRequirement !== undefined
          ? { playthroughRequirement: dto.playthroughRequirement as Prisma.InputJsonValue }
          : {}),
        ...(dto.claimLimitPerUser !== undefined ? { claimLimitPerUser: dto.claimLimitPerUser } : {}),
        ...(dto.maxParticipants !== undefined ? { maxParticipants: dto.maxParticipants } : {}),
      },
    });
  }

  // ── Admin: AMOE decisions ────────────────────────────────────────────

  async listAmoeRequestsAdmin(filters: { status?: string }) {
    return this.prisma.amoeRequest.findMany({
      where: filters.status ? { status: filters.status as AmoeStatus } : {},
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAmoeRequestAdmin(id: string) {
    const request = await this.prisma.amoeRequest.findUnique({ where: { id } });
    if (!request) {
      throw new NotFoundException({ code: 'AMOE_REQUEST_NOT_FOUND', message: 'AMOE request not found.' });
    }
    return request;
  }

  /**
   * Approve/reject an AMOE request. On APPROVED with a `scAwarded` amount,
   * the SC grant is itself gated behind `sc.promotional_issuance_enabled`:
   * if the flag is off we still record the decision (status, reason,
   * scAwarded all persist) rather than silently dropping the award, and the
   * response's `scGrant.awarded=false` + explanatory reason tells the
   * caller the award is pending the flag. The idempotencyKey
   * (`amoe:{requestId}`) means an admin can safely re-PATCH the same
   * decision later (e.g. once the flag flips) to actually post the grant
   * without risking a double-issuance.
   */
  async decideAmoeRequest(id: string, adminId: string, dto: AdminAmoeDecisionDto) {
    const before = await this.getAmoeRequestAdmin(id);

    const updated = await this.prisma.amoeRequest.update({
      where: { id },
      data: {
        status: dto.status,
        reviewedBy: adminId,
        reason: dto.reason,
        scAwarded: dto.scAwarded ?? before.scAwarded ?? undefined,
        decidedAt: new Date(),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: 'amoe.decide',
        targetType: 'amoe_request',
        targetId: id,
        oldState: before as unknown as object,
        newState: updated as unknown as object,
        reason: dto.reason,
      },
    });

    let scGrant: { awarded: boolean; reason?: string } = { awarded: false };

    if (dto.status === 'APPROVED' && dto.scAwarded && isPositive(dto.scAwarded)) {
      const flag = await this.prisma.featureFlag.findUnique({ where: { key: SC_ISSUANCE_FLAG } });
      if (flag?.enabled) {
        await this.walletService.postEntries(before.userId, 'SC', [
          {
            type: 'PROMO_GRANT',
            amount: dto.scAwarded,
            source: 'PROMOTION',
            idempotencyKey: `amoe:${id}`,
            adminActorId: adminId,
            metadata: { amoeRequestId: id, promotionId: before.promotionId },
          },
        ]);
        scGrant = { awarded: true };
      } else {
        scGrant = {
          awarded: false,
          reason: `FEATURE_DISABLED: ${SC_ISSUANCE_FLAG} is off. The approval and sc_awarded amount are recorded, but the SC has not been issued yet — re-run this decision once the flag is enabled to post the grant (idempotency key prevents double-issuance).`,
        };
      }
    }

    return { request: updated, scGrant };
  }
}
