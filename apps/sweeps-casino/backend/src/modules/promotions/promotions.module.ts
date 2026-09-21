import { Module } from '@nestjs/common';
import { PromotionsService } from './promotions.service';
import { PromotionsController } from './promotions.controller';
import { AdminPromotionsController } from './admin-promotions.controller';
import { AmoeController } from './amoe.controller';
import { AdminAmoeController } from './admin-amoe.controller';
import { WalletModule } from '../wallet/wallet.module';
import { VipModule } from '../vip/vip.module';

@Module({
  imports: [WalletModule, VipModule],
  controllers: [
    PromotionsController,
    AdminPromotionsController,
    AmoeController,
    AdminAmoeController,
  ],
  providers: [PromotionsService],
  exports: [PromotionsService],
})
export class PromotionsModule {}
