import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';

const USER_SUMMARY_SELECT = {
  id: true,
  email: true,
  username: true,
  status: true,
  kycStatus: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
  ) {}

  /**
   * GET /admin/users?query=. Searches username (ILIKE) / email (ILIKE) /
   * id (exact) OR resolves `query` as a LedgerEntry id and returns that
   * entry's wallet's user. Results are merged and de-duplicated by user id.
   */
  async search(query?: string) {
    const q = query?.trim();
    if (!q) {
      return this.prisma.user.findMany({
        take: 50,
        orderBy: { createdAt: 'desc' },
        select: USER_SUMMARY_SELECT,
      });
    }

    const [byUsername, byEmail, byId, byLedgerEntry] = await Promise.all([
      this.prisma.user.findMany({
        where: { username: { contains: q, mode: 'insensitive' } },
        take: 25,
        select: USER_SUMMARY_SELECT,
      }),
      this.prisma.user.findMany({
        where: { email: { contains: q, mode: 'insensitive' } },
        take: 25,
        select: USER_SUMMARY_SELECT,
      }),
      this.prisma.user.findUnique({ where: { id: q }, select: USER_SUMMARY_SELECT }),
      this.prisma.ledgerEntry.findUnique({
        where: { id: q },
        select: { wallet: { select: { userId: true } } },
      }),
    ]);

    const results = new Map<string, (typeof byUsername)[number]>();
    for (const u of byUsername) results.set(u.id, u);
    for (const u of byEmail) results.set(u.id, u);
    if (byId) results.set(byId.id, byId);
    if (byLedgerEntry) {
      const u = await this.prisma.user.findUnique({
        where: { id: byLedgerEntry.wallet.userId },
        select: USER_SUMMARY_SELECT,
      });
      if (u) results.set(u.id, u);
    }

    return Array.from(results.values());
  }

  async getDetail(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { profile: true } });
    if (!user) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' });
    }

    const [wallets, ledger, sessions, devices, kycRecords, riskEvents, notes] = await Promise.all([
      this.walletService.getWallets(userId),
      this.walletService.getTransactions(userId, { limit: 50 }),
      this.prisma.session.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.device.findMany({ where: { userId }, orderBy: { lastSeenAt: 'desc' } }),
      this.prisma.kycRecord.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.riskEvent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      // No dedicated "admin notes" table exists in the schema (see
      // prisma/schema.prisma) — notes are represented as AuditLog rows
      // with action:'user.note', targetType:'user', newState:{note}.
      // See addNote() below for the write side of this convention.
      this.prisma.auditLog.findMany({
        where: { targetType: 'user', targetId: userId, action: 'user.note' },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const { passwordHash: _passwordHash, totpSecretEnc: _totpSecretEnc, backupCodesEnc: _backupCodesEnc, ...safeUser } = user;

    return {
      user: safeUser,
      wallets,
      ledger: ledger.entries,
      sessions,
      devices,
      kycRecords,
      riskEvents,
      notes: notes.map((n) => ({
        id: n.id,
        note: (n.newState as { note?: string } | null)?.note ?? null,
        adminId: n.adminId,
        createdAt: n.createdAt,
      })),
    };
  }

  /**
   * POST /admin/users/:id/status. Only toggles ACTIVE <-> SUSPENDED. The
   * DTO already restricts the *target* value to those two; this also
   * blocks based on the *current* value: SELF_EXCLUDED can't be lifted
   * here (that's a manual, audited, out-of-this-endpoint action per the
   * responsible-play guard), and CLOSED accounts aren't reactivated here
   * either, since neither is "toggling between ACTIVE and SUSPENDED."
   */
  async setStatus(userId: string, adminId: string, status: 'ACTIVE' | 'SUSPENDED', reason: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' });
    }

    if (user.status === 'SELF_EXCLUDED') {
      throw new BadRequestException({
        code: 'SELF_EXCLUSION_NOT_TOGGLEABLE',
        message:
          'This user is self-excluded. Self-exclusion cannot be lifted through this endpoint — ' +
          'see docs/02-database-schema.md responsible-play guard.',
      });
    }
    if (user.status === 'CLOSED') {
      throw new BadRequestException({
        code: 'ACCOUNT_CLOSED',
        message: 'This account is closed and cannot be toggled between ACTIVE/SUSPENDED through this endpoint.',
      });
    }

    const updated = await this.prisma.user.update({ where: { id: userId }, data: { status } });

    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: 'user.status_change',
        targetType: 'user',
        targetId: userId,
        oldState: { status: user.status },
        newState: { status: updated.status },
        reason,
      },
    });

    return { id: updated.id, status: updated.status };
  }

  async addNote(userId: string, adminId: string, note: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' });
    }

    const log = await this.prisma.auditLog.create({
      data: { adminId, action: 'user.note', targetType: 'user', targetId: userId, newState: { note } },
    });

    return { id: log.id, note, adminId, createdAt: log.createdAt };
  }
}
