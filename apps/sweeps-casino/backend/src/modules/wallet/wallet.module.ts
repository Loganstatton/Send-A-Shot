import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { AdminWalletController, AdminLedgerController } from './admin-wallet.controller';

@Module({
  controllers: [WalletController, AdminWalletController, AdminLedgerController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
