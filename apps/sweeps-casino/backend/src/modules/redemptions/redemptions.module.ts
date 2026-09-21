import { Module } from '@nestjs/common';
import { RedemptionsService } from './redemptions.service';
import { RedemptionsController } from './redemptions.controller';
import { AdminRedemptionsController } from './admin-redemptions.controller';
import { WalletModule } from '../wallet/wallet.module';
import { RiskModule } from '../risk/risk.module';
import { ComplianceModule } from '../compliance/compliance.module';

@Module({
  imports: [WalletModule, RiskModule, ComplianceModule],
  controllers: [RedemptionsController, AdminRedemptionsController],
  providers: [RedemptionsService],
  exports: [RedemptionsService],
})
export class RedemptionsModule {}
