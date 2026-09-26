import { Module } from '@nestjs/common';
import { KycService } from './kyc.service';
import { KycController } from './kyc.controller';
import { KycWebhookController } from './kyc-webhook.controller';
import { AdminKycController } from './admin-kyc.controller';
import { KYC_PROVIDER, MockKycProvider } from './providers/kyc.provider';

@Module({
  controllers: [KycController, KycWebhookController, AdminKycController],
  providers: [
    KycService,
    // DI-token binding — swap to a real vendor adapter later by changing
    // only this line (docs/01-architecture.md §5, §10).
    { provide: KYC_PROVIDER, useClass: MockKycProvider },
  ],
  exports: [KycService],
})
export class KycModule {}
