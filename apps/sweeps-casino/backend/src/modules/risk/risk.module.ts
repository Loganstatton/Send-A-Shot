import { Module } from '@nestjs/common';
import { RiskService } from './risk.service';
import { AdminRiskController } from './admin-risk.controller';

@Module({
  controllers: [AdminRiskController],
  providers: [RiskService],
  exports: [RiskService],
})
export class RiskModule {}
