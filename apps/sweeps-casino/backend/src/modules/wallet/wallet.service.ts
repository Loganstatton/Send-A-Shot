import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Currency, LedgerEntryType, LedgerSource, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { addCents, toCents } from '../../libs/money/money';

export interface PostEntryInput {
  type: LedgerEntryType;
  /** Signed decimal string: "-1.00" debits, "2.50" credits. */
  amount: string;
  source: LedgerSource;
  idempotencyKey: string;
  gameRoundId?: string;
  paymentId?: string;
  redemptionId?: string;
  promotionClaimId?: string;
  adminActorId?: string;
  metadata?: Prisma.InputJsonValue;
}

export interface PostEntriesResult {
  walletId: string;
  balanceAfter: string;
  entries: Prisma.LedgerEntryGetPayload<Record<string, never>>[];
}

/**
 * The ONLY code path in this codebase that writes ledger_entries or
 * mutates wallets.balance. Every other module (casino, promotions,
 * vip, payments, redemptions, admin) calls postEntries() instead of
 * touching Prisma's Wallet/LedgerEntry models directly — this is what
 * keeps the ledger invariants in docs/02-database-schema.md true
 * platform-wide instead of "true if every caller remembers."
 */
@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getWallets(userId: string) {
    const wallets = await this.prisma.wallet.findMany({ where: { userId } });
    const gc = wallets.find((w) => w.currency === 'GC');
    const sc = wallets.find((w) => w.currency === 'SC');
    return {
      gc: { balance: gc?.balance.toString() ?? '0.00' },
      sc: { balance: sc?.balance.toString() ?? '0.00' },
    };
  }

  async getTransactions(
    userId: string,
    opts: { currency?: Currency; type?: LedgerEntryType; cursor?: string; limit?: number },
  ) {
    const wallets = await this.prisma.wallet.findMany({
      where: { userId, ...(opts.currency ? { currency: opts.currency } : {}) },
      select: { id: true },
    });
    const walletIds = wallets.map((w) => w.id);
    const limit = Math.min(opts.limit ?? 50, 100);

    const entries = await this.prisma.ledgerEntry.findMany({
      where: {
        walletId: { in: walletIds },
        ...(opts.type ? { type: opts.type } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });

    const hasMore = entries.length > limit;
    const page = hasMore ? entries.slice(0, limit) : entries;
    return { entries: page, nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  /**
   * Posts one or more ledger entries against a single (userId, currency)
   * wallet inside one DB transaction, under a row lock, so concurrent
   * requests against the same wallet cannot interleave. Each entry's
   * idempotencyKey is checked against (walletId, idempotencyKey) before
   * insert — a retried key returns the original entry rather than
   * double-posting (this is the mechanism, not a convention, behind "a
   * duplicate WIN callback only credits once").
   */
  async postEntries(
    userId: string,
    currency: Currency,
    entries: PostEntryInput[],
  ): Promise<PostEntriesResult> {
    if (entries.length === 0) {
      throw new BadRequestException({ code: 'NO_ENTRIES', message: 'No ledger entries provided.' });
    }

    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId_currency: { userId, currency } } });
      if (!wallet) {
        throw new NotFoundException({ code: 'WALLET_NOT_FOUND', message: 'Wallet not found.' });
      }

      // Row lock: serializes concurrent postEntries calls against this wallet.
      await tx.$queryRaw`SELECT id FROM wallets WHERE id::text = ${wallet.id} FOR UPDATE`;

      const fresh = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      let runningBalance = fresh.balance.toString();
      const results: Prisma.LedgerEntryGetPayload<Record<string, never>>[] = [];

      for (const entry of entries) {
        const existing = await tx.ledgerEntry.findUnique({
          where: {
            walletId_idempotencyKey: { walletId: wallet.id, idempotencyKey: entry.idempotencyKey },
          },
        });

        if (existing) {
          runningBalance = existing.balanceAfter.toString();
          results.push(existing);
          continue;
        }

        const balanceBefore = runningBalance;
        const balanceAfter = addCents(balanceBefore, entry.amount);

        if (toCents(balanceAfter) < 0n) {
          throw new BadRequestException({
            code: 'INSUFFICIENT_BALANCE',
            message: `Insufficient ${currency} balance for this operation.`,
          });
        }

        const created = await tx.ledgerEntry.create({
          data: {
            walletId: wallet.id,
            currency,
            type: entry.type,
            amount: entry.amount,
            balanceBefore,
            balanceAfter,
            source: entry.source,
            idempotencyKey: entry.idempotencyKey,
            gameRoundId: entry.gameRoundId,
            paymentId: entry.paymentId,
            redemptionId: entry.redemptionId,
            promotionClaimId: entry.promotionClaimId,
            adminActorId: entry.adminActorId,
            metadata: entry.metadata,
          },
        });

        runningBalance = balanceAfter;
        results.push(created);
      }

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: runningBalance, balanceVerifiedAt: new Date() },
      });

      return { walletId: wallet.id, balanceAfter: runningBalance, entries: results };
    });
  }

  async getTransactionForUser(userId: string, entryId: string) {
    const entry = await this.prisma.ledgerEntry.findUnique({
      where: { id: entryId },
      include: { wallet: true },
    });
    if (!entry || entry.wallet.userId !== userId) {
      throw new NotFoundException({ code: 'TRANSACTION_NOT_FOUND', message: 'Transaction not found.' });
    }
    return entry;
  }

  /** Used by the reconciliation job: recompute a wallet's balance purely from its ledger. */
  async computeLedgerBalance(walletId: string): Promise<string> {
    const result = await this.prisma.ledgerEntry.aggregate({
      where: { walletId },
      _sum: { amount: true },
    });
    return (result._sum.amount ?? new Prisma.Decimal(0)).toString();
  }

  async reconcileAllWallets(): Promise<{ walletId: string; cached: string; computed: string }[]> {
    const wallets = await this.prisma.wallet.findMany();
    const drift: { walletId: string; cached: string; computed: string }[] = [];

    for (const wallet of wallets) {
      const computed = await this.computeLedgerBalance(wallet.id);
      const cached = wallet.balance.toString();
      if (toCents(computed) !== toCents(cached)) {
        drift.push({ walletId: wallet.id, cached, computed });
        this.logger.error(`Ledger drift on wallet ${wallet.id}: cached=${cached} computed=${computed}`);
      } else {
        await this.prisma.wallet.update({
          where: { id: wallet.id },
          data: { balanceVerifiedAt: new Date() },
        });
      }
    }

    return drift;
  }
}
