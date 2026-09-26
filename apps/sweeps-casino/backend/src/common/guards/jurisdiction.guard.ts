import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';

export type JurisdictionCapability = 'SC' | 'REDEMPTION';

export const JURISDICTION_CAPABILITY_KEY = 'requiredJurisdictionCapability';
export const RequireJurisdiction = (capability: JurisdictionCapability) =>
  Reflect.metadata(JURISDICTION_CAPABILITY_KEY, capability);

/**
 * Runs after JwtAuthGuard on authenticated routes. Resolves the caller's
 * state of record and checks it against the jurisdictions table (never a
 * hard-coded list — see docs/02-database-schema.md §Compliance). This
 * guard covers post-registration capability checks (SC gameplay,
 * redemption); registration itself is checked inline in AuthService
 * since there's no authenticated user yet to attach a guard to.
 */
@Injectable()
export class JurisdictionGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const capability = this.reflector.get<JurisdictionCapability | undefined>(
      JURISDICTION_CAPABILITY_KEY,
      context.getHandler(),
    );
    if (!capability) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as { userId: string };

    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.userId },
      select: { stateOfRecord: true },
    });

    if (!dbUser?.stateOfRecord) {
      throw new ForbiddenException({
        code: 'JURISDICTION_UNKNOWN',
        message: 'Unable to determine your jurisdiction.',
      });
    }

    const jurisdiction = await this.prisma.jurisdiction.findUnique({
      where: { state: dbUser.stateOfRecord },
    });
    const status = jurisdiction?.status ?? 'BLOCKED';

    const blockedFor: Record<JurisdictionCapability, string[]> = {
      SC: ['GC_ONLY', 'SC_DISABLED', 'BLOCKED'],
      REDEMPTION: ['REDEMPTION_DISABLED', 'BLOCKED'],
    };

    if (blockedFor[capability].includes(status)) {
      throw new ForbiddenException({
        code: 'JURISDICTION_RESTRICTED',
        message: `This feature is not available in your state (${dbUser.stateOfRecord}).`,
      });
    }

    return true;
  }
}
