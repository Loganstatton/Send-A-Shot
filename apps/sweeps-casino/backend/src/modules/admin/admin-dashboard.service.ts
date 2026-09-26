import { Injectable } from '@nestjs/common';
import { Currency, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getMetrics() {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      activeUserRows,
      newUsersToday,
      gcWageredToday,
      scWageredToday,
      pendingKycCount,
      suspiciousAccountsCount,
      activePromotionsCount,
      purchasesFlag,
    ] = await Promise.all([
      this.prisma.user.count(),
      // "Active" = distinct users with a successful LoginEvent in the last
      // 30 days. Failed login attempts don't count toward activity.
      this.prisma.loginEvent.findMany({
        where: { result: 'SUCCESS', createdAt: { gte: thirtyDaysAgo } },
        distinct: ['userId'],
        select: { userId: true },
      }),
      this.prisma.user.count({ where: { createdAt: { gte: startOfToday } } }),
      this.sumWageredToday('GC', startOfToday),
      this.sumWageredToday('SC', startOfToday),
      this.prisma.kycRecord.count({ where: { status: { in: ['PENDING', 'REVIEW_REQUIRED'] } } }),
      this.prisma.riskEvent.count({ where: { outcome: { in: ['REVIEW', 'BLOCK'] }, resolvedAt: null } }),
      this.prisma.promotion.count({ where: { status: 'ACTIVE' } }),
      this.prisma.featureFlag.findUnique({ where: { key: 'payments.purchases_enabled' } }),
    ]);

    const purchasesEnabled = purchasesFlag?.enabled ?? false;
    const revenue = purchasesEnabled
      ? await this.getRevenueToday(startOfToday)
      : {
          revenueTodayUsd: '0.00',
          purchaseCountToday: 0,
          note: "payments.purchases_enabled is off — purchases aren't accepted, so revenue metrics are zeroed.",
        };

    return {
      totalUsers,
      activeUsers: activeUserRows.length,
      newUsersToday,
      gcWageredToday,
      scWageredToday,
      pendingKycCount,
      suspiciousAccountsCount,
      activePromotionsCount,
      ...revenue,
    };
  }

  private async sumWageredToday(currency: Currency, since: Date): Promise<string> {
    const agg = await this.prisma.ledgerEntry.aggregate({
      where: { type: 'BET', currency, createdAt: { gte: since } },
      _sum: { amount: true },
    });
    // BET amounts are stored as negative (debits); the dashboard wants a
    // positive "amount wagered" figure.
    const sum = agg._sum.amount ?? new Prisma.Decimal(0);
    return sum.abs().toString();
  }

  private async getRevenueToday(since: Date) {
    const agg = await this.prisma.payment.aggregate({
      where: { type: 'PURCHASE', status: 'SUCCEEDED', createdAt: { gte: since } },
      _sum: { amountUsd: true },
      _count: true,
    });
    return {
      revenueTodayUsd: (agg._sum.amountUsd ?? new Prisma.Decimal(0)).toString(),
      purchaseCountToday: agg._count,
    };
  }
}
