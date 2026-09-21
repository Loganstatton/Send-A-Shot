import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Currency, Prisma, VipLevel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { addCents, fromCents, toCents } from '../../libs/money/money';
import { computePoints } from './lib/points';

/** Fields safe to expose to players — internal formulas (multipliers, minPoints,
 * rakebackBps, reward configs) are admin-only per docs/04 screen map. */
export interface PublicVipLevel {
  id: string;
  rankOrder: number;
  name: string;
  benefits: Prisma.JsonValue | null;
}

@Injectable()
export class VipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
  ) {}

  private toPublicLevel(level: VipLevel): PublicVipLevel {
    return { id: level.id, rankOrder: level.rankOrder, name: level.name, benefits: level.benefits };
  }

  async listLevelsPublic(): Promise<PublicVipLevel[]> {
    const levels = await this.prisma.vipLevel.findMany({ orderBy: { rankOrder: 'asc' } });
    return levels.map((l) => this.toPublicLevel(l));
  }

  async listLevelsAdmin(): Promise<VipLevel[]> {
    return this.prisma.vipLevel.findMany({ orderBy: { rankOrder: 'asc' } });
  }

  async getLevelAdmin(id: string): Promise<VipLevel> {
    const level = await this.prisma.vipLevel.findUnique({ where: { id } });
    if (!level) {
      throw new NotFoundException({ code: 'VIP_LEVEL_NOT_FOUND', message: 'VIP level not found.' });
    }
    return level;
  }

  async createLevel(data: Prisma.VipLevelCreateInput): Promise<VipLevel> {
    return this.prisma.vipLevel.create({ data });
  }

  async updateLevel(id: string, data: Prisma.VipLevelUpdateInput): Promise<VipLevel> {
    await this.getLevelAdmin(id);
    return this.prisma.vipLevel.update({ where: { id }, data });
  }

  async getMe(userId: string) {
    let progress = await this.prisma.vipProgress.findUnique({
      where: { userId },
      include: { currentLevel: true },
    });

    if (!progress) {
      const baseLevel = await this.prisma.vipLevel.findFirst({ orderBy: { rankOrder: 'asc' } });
      if (!baseLevel) {
        throw new NotFoundException({
          code: 'VIP_NOT_CONFIGURED',
          message: 'The VIP ladder has not been configured yet.',
        });
      }
      progress = await this.prisma.vipProgress.create({
        data: { userId, currentLevelId: baseLevel.id },
        include: { currentLevel: true },
      });
    }

    const nextLevel = await this.prisma.vipLevel.findUnique({
      where: { rankOrder: progress.currentLevel.rankOrder + 1 },
    });

    const lifetimePoints = progress.lifetimePoints.toString();
    const pointsNeeded = nextLevel
      ? (() => {
          const needCents = toCents(nextLevel.minPoints.toString()) - toCents(lifetimePoints);
          return fromCents(needCents > 0n ? needCents : 0n);
        })()
      : null;

    const rewards = await this.prisma.vipReward.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    // XP into the current level: for the base level this is just
    // lifetimePoints (minPoints=0); for higher levels it's the points
    // earned past that level's own threshold. currentLevel.minPoints is
    // intentionally NOT exposed on the public ladder (/vip/levels --
    // internal formula per docs/04), but here on the authenticated /me
    // response it's the only way to render a real "X / Y XP" progress
    // bar instead of a hardcoded one, so we compute with it server-side
    // and only return the derived numbers, not the raw ladder value.
    const currentLevelMinPoints = progress.currentLevel.minPoints.toString();
    const pointsIntoLevelCents = toCents(lifetimePoints) - toCents(currentLevelMinPoints);
    const pointsIntoLevel = fromCents(pointsIntoLevelCents > 0n ? pointsIntoLevelCents : 0n);
    const levelSpan = nextLevel
      ? fromCents(toCents(nextLevel.minPoints.toString()) - toCents(currentLevelMinPoints))
      : null;

    return {
      currentLevel: this.toPublicLevel(progress.currentLevel),
      periodPoints: progress.periodPoints.toString(),
      lifetimePoints,
      progress: {
        pointsIntoLevel,
        pointsForLevel: levelSpan, // null when already at the top level
        pointsNeeded,
      },
      nextLevel: nextLevel ? { name: nextLevel.name, pointsNeeded } : null,
      rewardHistorySummary: {
        totalRewards: rewards.length,
        recent: rewards.map((r) => ({
          id: r.id,
          type: r.type,
          amount: r.amount.toString(),
          currency: r.currency,
          createdAt: r.createdAt,
        })),
      },
    };
  }

  async getRewards(userId: string) {
    return this.prisma.vipReward.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  /**
   * Called by other modules (Casino) after a game round settles. Looks up
   * (or lazily creates) the player's VipProgress, credits points for the
   * wager, and promotes them through the ladder as far as lifetime points
   * allow — granting any configured rankUpReward along the way.
   *
   * Rank-up wallet grants happen AFTER the points/promotion transaction
   * commits, not inside it: WalletService.postEntries() opens its own
   * prisma.$transaction() internally, and nesting a second interactive
   * transaction on the same PrismaClient inside this one is unsafe (risk of
   * connection-pool exhaustion / non-atomic partial commits). The
   * idempotencyKey on each grant (`vip-rankup:${userId}:${levelId}`) makes
   * this safe to retry if the process dies between the two steps.
   */
  async recordWager(userId: string, currency: 'GC' | 'SC', wageredAmount: string): Promise<void> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      let progress = await tx.vipProgress.findUnique({ where: { userId } });
      let currentLevel: VipLevel;

      if (!progress) {
        const baseLevel = await tx.vipLevel.findFirst({ orderBy: { rankOrder: 'asc' }, take: 1 });
        if (!baseLevel) return null; // no ladder configured — nothing to record against
        progress = await tx.vipProgress.create({ data: { userId, currentLevelId: baseLevel.id } });
        currentLevel = baseLevel;
      } else {
        currentLevel = await tx.vipLevel.findUniqueOrThrow({ where: { id: progress.currentLevelId } });
      }

      const multiplier = (
        currency === 'GC' ? currentLevel.gcPointsMultiplier : currentLevel.scPointsMultiplier
      ).toString();
      const pointsEarned = computePoints(wageredAmount, multiplier);

      progress = await tx.vipProgress.update({
        where: { userId },
        data: {
          periodPoints: addCents(progress.periodPoints.toString(), pointsEarned),
          lifetimePoints: addCents(progress.lifetimePoints.toString(), pointsEarned),
        },
      });

      const rankUps: VipLevel[] = [];
      let rank = currentLevel.rankOrder;
      const lifetime = progress.lifetimePoints.toString();

      let nextLevel = await tx.vipLevel.findUnique({ where: { rankOrder: rank + 1 } });
      while (nextLevel && toCents(nextLevel.minPoints.toString()) <= toCents(lifetime)) {
        await tx.vipProgress.update({ where: { userId }, data: { currentLevelId: nextLevel.id } });
        rankUps.push(nextLevel);
        rank = nextLevel.rankOrder;
        nextLevel = await tx.vipLevel.findUnique({ where: { rankOrder: rank + 1 } });
      }

      return { rankUps };
    });

    if (!outcome) return;

    for (const level of outcome.rankUps) {
      const reward = level.rankUpReward as { currency?: Currency; amount?: string } | null;
      if (!reward?.currency || !reward?.amount) continue;

      const result = await this.walletService.postEntries(userId, reward.currency, [
        {
          type: 'VIP_REWARD',
          amount: reward.amount,
          source: 'VIP',
          idempotencyKey: `vip-rankup:${userId}:${level.id}`,
          metadata: { vipLevelId: level.id, reason: 'rank_up' },
        },
      ]);

      const ledgerEntry = result.entries[0];
      await this.prisma.vipReward.create({
        data: {
          userId,
          vipLevelId: level.id,
          type: 'RANK_UP',
          amount: reward.amount,
          currency: reward.currency,
          ledgerEntryId: ledgerEntry?.id,
        },
      });
    }
  }

  /** Used by PromotionsService for minVipLevelId eligibility checks. */
  async getUserRankOrder(userId: string): Promise<number> {
    const progress = await this.prisma.vipProgress.findUnique({
      where: { userId },
      include: { currentLevel: true },
    });
    if (progress) return progress.currentLevel.rankOrder;

    const baseLevel = await this.prisma.vipLevel.findFirst({ orderBy: { rankOrder: 'asc' } });
    if (!baseLevel) {
      throw new ForbiddenException({
        code: 'VIP_NOT_CONFIGURED',
        message: 'The VIP ladder has not been configured yet.',
      });
    }
    return baseLevel.rankOrder;
  }
}
