import { Injectable } from '@nestjs/common';
import { JurisdictionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PatchJurisdictionDto } from './dto/jurisdiction.dto';
import { PatchFeatureFlagDto } from './dto/feature-flag.dto';

export interface JurisdictionCapabilities {
  registration: boolean;
  scPlay: boolean;
  redemption: boolean;
}

export interface JurisdictionStatusResult {
  state: string | null;
  status: JurisdictionStatus;
  capabilities: JurisdictionCapabilities;
}

const CONSERVATIVE_DEFAULT_STATUS: JurisdictionStatus = 'BLOCKED';

/**
 * Owns jurisdictions / compliance_config_versions / feature_flags per
 * docs/02-database-schema.md §Compliance. Nothing here asserts legality —
 * it only reports and edits whatever the currently configured values say
 * (docs/01-architecture.md §7).
 */
@Injectable()
export class ComplianceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Mirrors exactly what JwtAuthGuard-adjacent enforcement already does
   * elsewhere (AuthService.register for `registration`,
   * JurisdictionGuard's blockedFor map for `scPlay`/`redemption`) so this
   * status report never drifts from what's actually enforced.
   */
  computeCapabilities(status: JurisdictionStatus): JurisdictionCapabilities {
    return {
      registration: !(['BLOCKED', 'REGISTRATION_DISABLED'] as JurisdictionStatus[]).includes(status),
      scPlay: !(['GC_ONLY', 'SC_DISABLED', 'BLOCKED'] as JurisdictionStatus[]).includes(status),
      redemption: !(['REDEMPTION_DISABLED', 'BLOCKED'] as JurisdictionStatus[]).includes(status),
    };
  }

  async getJurisdictionStatusForState(state: string | null | undefined): Promise<JurisdictionStatusResult> {
    if (!state) {
      return {
        state: null,
        status: CONSERVATIVE_DEFAULT_STATUS,
        capabilities: this.computeCapabilities(CONSERVATIVE_DEFAULT_STATUS),
      };
    }

    const normalized = state.toUpperCase();
    const jurisdiction = await this.prisma.jurisdiction.findUnique({ where: { state: normalized } });
    const status = jurisdiction?.status ?? CONSERVATIVE_DEFAULT_STATUS;

    return { state: normalized, status, capabilities: this.computeCapabilities(status) };
  }

  async listJurisdictions() {
    return this.prisma.jurisdiction.findMany({ orderBy: { state: 'asc' } });
  }

  async updateJurisdiction(state: string, dto: PatchJurisdictionDto, adminId: string) {
    const normalized = state.toUpperCase();

    return this.prisma.$transaction(async (tx) => {
      const before = await tx.jurisdiction.findUnique({ where: { state: normalized } });

      const after = await tx.jurisdiction.upsert({
        where: { state: normalized },
        create: {
          state: normalized,
          status: dto.status ?? 'REGISTRATION_DISABLED',
          minAge: dto.minAge ?? 21,
          updatedBy: adminId,
        },
        update: {
          ...(dto.status ? { status: dto.status } : {}),
          ...(dto.minAge !== undefined ? { minAge: dto.minAge } : {}),
          updatedBy: adminId,
        },
      });

      await this.appendConfigVersion(tx, `jurisdiction:${normalized}`, { before, after }, adminId, dto.changeReason);

      return after;
    });
  }

  async listFeatureFlags() {
    return this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
  }

  async updateFeatureFlag(key: string, dto: PatchFeatureFlagDto, adminId: string) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.featureFlag.findUnique({ where: { key } });

      const after = await tx.featureFlag.upsert({
        where: { key },
        create: {
          key,
          enabled: dto.enabled ?? false,
          rolloutMeta: (dto.rolloutMeta as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          updatedBy: adminId,
        },
        update: {
          ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
          ...(dto.rolloutMeta !== undefined
            ? { rolloutMeta: (dto.rolloutMeta as Prisma.InputJsonValue) ?? Prisma.JsonNull }
            : {}),
          updatedBy: adminId,
        },
      });

      await this.appendConfigVersion(tx, `feature-flag:${key}`, { before, after }, adminId, dto.changeReason);

      return after;
    });
  }

  async getConfigHistory(key: string) {
    return this.prisma.complianceConfigVersion.findMany({
      where: { configKey: key },
      orderBy: { version: 'desc' },
    });
  }

  /**
   * Shared versioning helper: every compliance-relevant write appends one
   * compliance_config_versions row, with `version` an independent
   * per-configKey sequence (1 + current max for that key) — see
   * docs/02-database-schema.md §Compliance.
   */
  private async appendConfigVersion(
    tx: Prisma.TransactionClient,
    configKey: string,
    value: unknown,
    changedBy: string,
    changeReason: string,
  ) {
    const maxVersion = await tx.complianceConfigVersion.aggregate({
      where: { configKey },
      _max: { version: true },
    });
    const nextVersion = (maxVersion._max.version ?? 0) + 1;

    return tx.complianceConfigVersion.create({
      data: {
        configKey,
        value: value as Prisma.InputJsonValue,
        version: nextVersion,
        changedBy,
        changeReason,
      },
    });
  }
}
