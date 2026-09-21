import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';

export const FEATURE_FLAG_KEY = 'requiredFeatureFlag';
export const RequireFeatureFlag = (key: string) =>
  Reflect.metadata(FEATURE_FLAG_KEY, key);

/**
 * Gates an endpoint behind a feature_flags row. Every SC-adjacent
 * capability (purchases, redemptions, SC-mode Originals, promotional SC
 * issuance) is wired through this guard rather than an inline env check,
 * so flipping the flag in /admin/compliance/feature-flags takes effect
 * immediately without a redeploy.
 */
@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const flagKey = this.reflector.get<string | undefined>(
      FEATURE_FLAG_KEY,
      context.getHandler(),
    );
    if (!flagKey) return true;

    const flag = await this.prisma.featureFlag.findUnique({ where: { key: flagKey } });
    if (!flag?.enabled) {
      throw new ForbiddenException({
        code: 'FEATURE_DISABLED',
        message: `This feature (${flagKey}) is not yet enabled on this platform.`,
      });
    }
    return true;
  }
}
