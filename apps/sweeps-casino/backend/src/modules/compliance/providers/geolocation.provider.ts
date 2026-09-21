import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../../config/configuration';

export type VpnRisk = 'LOW' | 'MEDIUM' | 'HIGH';

export interface GeoResult {
  state: string;
  vpnRisk: VpnRisk;
}

/**
 * Provider-abstraction interface per docs/01-architecture.md §5. A real
 * vendor (MaxMind, IPQualityScore, etc.) implements this same interface and
 * is swapped in purely via the GEOLOCATION_PROVIDER DI binding below — no
 * controller/service code changes.
 *
 * The optional `debugStateOverride` param is a Phase-1-only extension of the
 * documented `resolve(ip)` signature: it carries the `x-debug-state` header
 * value (when present) so the mock can honor it without the interface
 * needing request/header access. A real provider implementation ignores it.
 */
export interface GeolocationProvider {
  resolve(ip: string, debugStateOverride?: string): Promise<GeoResult>;
}

export const GEOLOCATION_PROVIDER = 'GEOLOCATION_PROVIDER';

/**
 * MOCK ONLY — replace with a real geolocation vendor adapter before relying
 * on this for any legally load-bearing jurisdiction decision. This
 * implementation never makes a network call; in non-production environments
 * it honors an `x-debug-state` header override (so QA/demo can simulate any
 * state), and otherwise always resolves to the first configured
 * `demoAllowedStates` entry. `vpnRisk` is always reported as `LOW` since the
 * mock has no real signal to compute it from.
 */
@Injectable()
export class MockGeolocationProvider implements GeolocationProvider {
  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  async resolve(_ip: string, debugStateOverride?: string): Promise<GeoResult> {
    const env = this.configService.get('env', { infer: true });

    if (env !== 'production' && debugStateOverride) {
      return { state: debugStateOverride.toUpperCase(), vpnRisk: 'LOW' };
    }

    const demoAllowedStates = this.configService.get('demoAllowedStates', { infer: true });
    const defaultState = demoAllowedStates?.[0] ?? 'NJ';
    return { state: defaultState.toUpperCase(), vpnRisk: 'LOW' };
  }
}
