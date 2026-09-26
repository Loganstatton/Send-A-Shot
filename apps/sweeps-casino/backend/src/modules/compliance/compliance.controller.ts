import { Controller, Get, Inject, Req } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { ComplianceService } from './compliance.service';
import { GEOLOCATION_PROVIDER, GeolocationProvider } from './providers/geolocation.provider';
import { PrismaService } from '../../prisma/prisma.service';
import { AppConfig } from '../../config/configuration';

/**
 * Public, pre-auth endpoint (no JwtAuthGuard) — usable before registration
 * so the client can explain "not available in your state" before the user
 * fills out a form. If a valid access JWT happens to be present it's parsed
 * optionally (never required) as a fallback signal.
 */
@Controller('compliance')
export class ComplianceController {
  constructor(
    private readonly complianceService: ComplianceService,
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig, true>,
    @Inject(GEOLOCATION_PROVIDER) private readonly geolocationProvider: GeolocationProvider,
  ) {}

  @Get('jurisdiction-status')
  async jurisdictionStatus(@Req() req: Request) {
    const state = await this.resolveState(req);
    const data = await this.complianceService.getJurisdictionStatusForState(state);
    return { data };
  }

  /**
   * Primary signal: geolocation resolved from the request IP (this is what
   * actually matters for compliance — it reflects the user's current
   * physical location even for an already-registered user who has
   * travelled). Falls back to the authenticated user's declared
   * stateOfRecord only when geolocation can't be resolved at all (e.g. no
   * IP present on the request, which the mock provider treats as a
   * resolution failure).
   */
  private async resolveState(req: Request): Promise<string | undefined> {
    const debugHeader = req.headers['x-debug-state'];
    const debugStateOverride = typeof debugHeader === 'string' ? debugHeader : undefined;

    if (req.ip) {
      try {
        const geo = await this.geolocationProvider.resolve(req.ip, debugStateOverride);
        if (geo?.state) return geo.state;
      } catch {
        // Fall through to the JWT-derived signal below.
      }
    }

    return this.tryGetStateFromJwt(req);
  }

  private async tryGetStateFromJwt(req: Request): Promise<string | undefined> {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return undefined;

    const token = authHeader.slice('Bearer '.length);
    try {
      const payload = await this.jwtService.verifyAsync<{ sub: string }>(token, {
        secret: this.configService.get('jwt.accessSecret', { infer: true }),
      });
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { stateOfRecord: true },
      });
      return user?.stateOfRecord ?? undefined;
    } catch {
      // Invalid/expired/missing token is fine here — this parse is optional.
      return undefined;
    }
  }
}
