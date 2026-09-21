import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Currency, LedgerEntryType } from '@prisma/client';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  async getWallet(@CurrentUser() user: AuthenticatedUser) {
    const wallets = await this.walletService.getWallets(user.userId);
    return { data: wallets };
  }

  @Get('transactions')
  async getTransactions(
    @CurrentUser() user: AuthenticatedUser,
    @Query('currency') currency?: Currency,
    @Query('type') type?: LedgerEntryType,
    @Query('cursor') cursor?: string,
  ) {
    const result = await this.walletService.getTransactions(user.userId, {
      currency,
      type,
      cursor,
    });
    return { data: result.entries, meta: { nextCursor: result.nextCursor } };
  }

  @Get('transactions/:id')
  async getTransaction(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const entry = await this.walletService.getTransactionForUser(user.userId, id);
    return { data: entry };
  }
}
