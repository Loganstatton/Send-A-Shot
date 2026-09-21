import { Module } from '@nestjs/common';
import { VipService } from './vip.service';
import { VipController } from './vip.controller';
import { AdminVipController } from './admin-vip.controller';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [WalletModule],
  controllers: [VipController, AdminVipController],
  providers: [VipService],
  exports: [VipService],
})
export class VipModule {}
