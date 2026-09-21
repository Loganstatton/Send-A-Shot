import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { UserModule } from './modules/user/user.module';
import { CasinoModule } from './modules/casino/casino.module';
import { PromotionsModule } from './modules/promotions/promotions.module';
import { VipModule } from './modules/vip/vip.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { KycModule } from './modules/kyc/kyc.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { RedemptionsModule } from './modules/redemptions/redemptions.module';
import { RiskModule } from './modules/risk/risk.module';
import { AdminModule } from './modules/admin/admin.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SupportModule } from './modules/support/support.module';
import { ProvablyFairModule } from './modules/provably-fair/provably-fair.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
    PrismaModule,
    AuthModule,
    UserModule,
    WalletModule,
    CasinoModule,
    ProvablyFairModule,
    PromotionsModule,
    VipModule,
    ComplianceModule,
    KycModule,
    PaymentsModule,
    RedemptionsModule,
    RiskModule,
    AdminModule,
    NotificationsModule,
    SupportModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
