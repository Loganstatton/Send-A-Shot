import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PaymentsWebhookController } from './payments-webhook.controller';
import { AdminPaymentsController } from './admin-payments.controller';
import { PAYMENT_PROVIDER, MockPaymentProvider } from './providers/payment.provider';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [WalletModule],
  controllers: [PaymentsController, PaymentsWebhookController, AdminPaymentsController],
  providers: [
    PaymentsService,
    // DI-token binding — swap to a real processor adapter later by
    // changing only this line (docs/01-architecture.md §5, §10).
    { provide: PAYMENT_PROVIDER, useClass: MockPaymentProvider },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
