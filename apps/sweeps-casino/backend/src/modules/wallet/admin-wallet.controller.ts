import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsString, Length } from 'class-validator';
import { Currency } from '@prisma/client';
import { randomUUID } from 'crypto';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentAdminId } from '../../common/decorators/current-admin.decorator';
import { PrismaService } from '../../prisma/prisma.service';

class AdjustBalanceDto {
  @IsIn(['GC', 'SC'])
  currency!: Currency;

  /** Signed decimal string, e.g. "10.00" or "-5.00". */
  @IsString()
  amount!: string;

  @IsString()
  @Length(3, 500)
  reason!: string;
}

@Controller('admin/users/:userId')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminWalletController {
  constructor(
    private readonly walletService: WalletService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('ledger')
  @RequirePermission('wallet.view_ledger')
  async getLedger(@Param('userId') userId: string, @Query('currency') currency?: Currency) {
    const result = await this.walletService.getTransactions(userId, { currency, limit: 100 });
    return { data: result.entries, meta: { nextCursor: result.nextCursor } };
  }

  @Post('adjust-balance')
  @RequirePermission('wallet.adjust_balance')
  async adjustBalance(
    @Param('userId') userId: string,
    @Body() dto: AdjustBalanceDto,
    @CurrentAdminId() adminId: string,
  ) {
    const before = await this.walletService.getWallets(userId);

    const result = await this.walletService.postEntries(userId, dto.currency, [
      {
        type: 'ADMIN_ADJUSTMENT',
        amount: dto.amount,
        source: 'ADMIN',
        idempotencyKey: randomUUID(),
        adminActorId: adminId,
        metadata: { reason: dto.reason },
      },
    ]);

    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: 'wallet.adjust_balance',
        targetType: 'user',
        targetId: userId,
        oldState: before as unknown as object,
        newState: { balanceAfter: result.balanceAfter, currency: dto.currency },
        reason: dto.reason,
      },
    });

    return { data: result };
  }
}

@Controller('admin/ledger')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminLedgerController {
  constructor(private readonly walletService: WalletService) {}

  @Get('reconciliation')
  @RequirePermission('wallet.view_ledger')
  async getRuns() {
    return { data: this.walletService.getReconciliationRuns() };
  }

  @Post('reconciliation/run')
  @RequirePermission('wallet.adjust_balance')
  async runNow() {
    return { data: await this.walletService.runReconciliation() };
  }
}
