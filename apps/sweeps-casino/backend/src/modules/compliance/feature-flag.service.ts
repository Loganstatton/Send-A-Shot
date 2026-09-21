import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Single read path for feature_flags, used both by FeatureFlagGuard-style
 * route gating (via direct Prisma lookup in the guard itself) and by other
 * modules that need to branch on a flag programmatically without wiring an
 * HTTP guard — e.g. redemptions eligibility reporting, or a future promo
 * engine deciding whether SC issuance is allowed. docs/01-architecture.md §8
 * calls for this to eventually be Redis-cached with a short TTL; Phase 1
 * reads straight from Postgres since flag flips are already rare/low-QPS
 * relative to a full request path.
 */
@Injectable()
export class FeatureFlagService {
  constructor(private readonly prisma: PrismaService) {}

  async isEnabled(key: string): Promise<boolean> {
    const flag = await this.prisma.featureFlag.findUnique({ where: { key } });
    return flag?.enabled ?? false;
  }

  async getAll() {
    return this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
  }
}
