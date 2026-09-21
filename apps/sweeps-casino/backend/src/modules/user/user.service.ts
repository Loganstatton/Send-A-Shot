import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateResponsiblePlayDto } from './dto/update-responsible-play.dto';
import { SelfExcludeDto } from './dto/self-exclude.dto';

/** SC-adjacent flags surfaced on the profile so the client knows what to render. */
const ME_FEATURE_FLAG_KEYS = ['sc.enabled', 'originals.sc_enabled'] as const;

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
    if (!user) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' });
    }

    // Pragmatic cross-domain exception (documented per task instructions):
    // the VIP module owns vip_progress/vip_levels, but a full VIP fetch is
    // overkill for a one-line profile summary, so we read the two fields we
    // need directly via PrismaService rather than depending on VipModule.
    const vipProgress = await this.prisma.vipProgress.findUnique({
      where: { userId },
      include: { currentLevel: { select: { name: true, rankOrder: true } } },
    });

    // Same pragmatic exception for feature flags: a read-only lookup of a
    // couple of SC-adjacent flags, not a write, so a direct query is fine
    // here instead of routing through the (not-yet-built) Compliance module.
    const flags = await this.prisma.featureFlag.findMany({
      where: { key: { in: [...ME_FEATURE_FLAG_KEYS] } },
    });
    const flagMap = new Map(flags.map((f) => [f.key, f.enabled]));

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      status: user.status,
      kycStatus: user.kycStatus,
      totpEnabled: user.totpEnabled,
      displayNameMasked: user.displayNameMasked,
      dateOfBirth: user.dateOfBirth,
      stateOfRecord: user.stateOfRecord,
      createdAt: user.createdAt,
      profile: user.profile
        ? {
            displayName: user.profile.chatDisplayName,
            avatarUrl: user.profile.avatarUrl,
            country: user.profile.country,
            timezone: user.profile.timezone,
            marketingOptIn: user.profile.marketingOptIn,
            chatAnonymized: user.profile.chatAnonymized,
          }
        : null,
      vip: vipProgress
        ? { levelName: vipProgress.currentLevel.name, rankOrder: vipProgress.currentLevel.rankOrder }
        : null,
      featureFlags: {
        'sc.enabled': flagMap.get('sc.enabled') ?? false,
        'originals.sc_enabled': flagMap.get('originals.sc_enabled') ?? false,
      },
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const data: Prisma.ProfileUpdateInput = {};
    if (dto.displayName !== undefined) data.chatDisplayName = dto.displayName;
    if (dto.avatarUrl !== undefined) data.avatarUrl = dto.avatarUrl;
    if (dto.chatAnonymized !== undefined) data.chatAnonymized = dto.chatAnonymized;
    if (dto.marketingOptIn !== undefined) data.marketingOptIn = dto.marketingOptIn;

    const profile = await this.prisma.profile.update({ where: { userId }, data });
    return {
      displayName: profile.chatDisplayName,
      avatarUrl: profile.avatarUrl,
      country: profile.country,
      timezone: profile.timezone,
      marketingOptIn: profile.marketingOptIn,
      chatAnonymized: profile.chatAnonymized,
    };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' });
    }

    const currentOk = await argon2.verify(user.passwordHash, dto.currentPassword).catch(() => false);
    if (!currentOk) {
      throw new UnauthorizedException({
        code: 'INVALID_CURRENT_PASSWORD',
        message: 'Current password is incorrect.',
      });
    }

    const passwordHash = await argon2.hash(dto.newPassword, { type: argon2.argon2id });
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    return { success: true };
  }

  async getResponsiblePlay(userId: string) {
    const controls = await this.prisma.responsiblePlayControls.findUnique({ where: { userId } });
    if (!controls) {
      throw new NotFoundException({
        code: 'RESPONSIBLE_PLAY_CONTROLS_NOT_FOUND',
        message: 'Responsible play controls not found for this account.',
      });
    }
    return controls;
  }

  async updateResponsiblePlay(userId: string, dto: UpdateResponsiblePlayDto) {
    const existing = await this.prisma.responsiblePlayControls.findUnique({ where: { userId } });
    if (!existing) {
      throw new NotFoundException({
        code: 'RESPONSIBLE_PLAY_CONTROLS_NOT_FOUND',
        message: 'Responsible play controls not found for this account.',
      });
    }

    const data: Prisma.ResponsiblePlayControlsUpdateInput = {};
    if ('depositLimitDaily' in dto) data.depositLimitDaily = dto.depositLimitDaily;
    if ('depositLimitWeekly' in dto) data.depositLimitWeekly = dto.depositLimitWeekly;
    if ('depositLimitMonthly' in dto) data.depositLimitMonthly = dto.depositLimitMonthly;
    if ('sessionReminderMinutes' in dto) data.sessionReminderMinutes = dto.sessionReminderMinutes;
    if ('coolingOffUntil' in dto) {
      data.coolingOffUntil = dto.coolingOffUntil ? new Date(dto.coolingOffUntil) : null;
    }

    return this.prisma.responsiblePlayControls.update({ where: { userId }, data });
  }

  /**
   * POST /me/responsible-play/self-exclude.
   *
   * This is the ONLY write path anywhere in this module for
   * self_exclusion_until / self_exclusion_permanent / self_excluded_at, and
   * it is deliberately one-directional: it can only set or extend an
   * exclusion, never shorten, clear, or lift one. There is no companion
   * "undo" endpoint in this module (or anywhere else in Phase 1) — per
   * docs/02-database-schema.md's responsible-play guard, reversing an
   * active self-exclusion is a manual, mandatorily-audited, SUPER_ADMIN-only
   * action reserved for Phase 2+, never a self-service or casual admin
   * toggle. Do not add a PATCH/DELETE here to "fix" a self-exclusion.
   */
  async selfExclude(userId: string, dto: SelfExcludeDto) {
    const wantsPermanent = dto.permanent === true;
    const wantsDuration = typeof dto.durationDays === 'number';
    if (wantsPermanent === wantsDuration) {
      throw new BadRequestException({
        code: 'INVALID_SELF_EXCLUDE_REQUEST',
        message: 'Provide exactly one of durationDays or permanent:true.',
      });
    }

    const existing = await this.prisma.responsiblePlayControls.findUnique({ where: { userId } });
    if (!existing) {
      throw new NotFoundException({
        code: 'RESPONSIBLE_PLAY_CONTROLS_NOT_FOUND',
        message: 'Responsible play controls not found for this account.',
      });
    }
    if (existing.selfExclusionPermanent) {
      throw new BadRequestException({
        code: 'ALREADY_PERMANENTLY_EXCLUDED',
        message: 'This account is already permanently self-excluded and cannot be changed through the API.',
      });
    }

    const now = new Date();
    let until: Date | null = null;
    if (wantsDuration) {
      until = new Date(now.getTime() + dto.durationDays! * 24 * 60 * 60 * 1000);
      if (existing.selfExclusionUntil && until.getTime() <= existing.selfExclusionUntil.getTime()) {
        throw new BadRequestException({
          code: 'CANNOT_SHORTEN_SELF_EXCLUSION',
          message: 'An active self-exclusion cannot be shortened. Choose a longer duration, or contact support for a permanent exclusion.',
        });
      }
    }

    await this.prisma.$transaction([
      this.prisma.responsiblePlayControls.update({
        where: { userId },
        data: {
          selfExclusionUntil: until,
          selfExclusionPermanent: wantsPermanent,
          selfExcludedAt: now,
        },
      }),
      this.prisma.user.update({ where: { id: userId }, data: { status: 'SELF_EXCLUDED' } }),
    ]);

    return {
      success: true,
      selfExclusionPermanent: wantsPermanent,
      selfExclusionUntil: until,
      status: 'SELF_EXCLUDED',
    };
  }

  async closeAccount(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' });
    }
    await this.prisma.user.update({ where: { id: userId }, data: { status: 'CLOSED' } });
    return { success: true, status: 'CLOSED' };
  }
}
