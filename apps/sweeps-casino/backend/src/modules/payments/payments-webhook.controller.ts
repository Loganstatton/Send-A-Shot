import { Controller, Headers, Param, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';

/**
 * Provider callback endpoint — intentionally NOT behind JwtAuthGuard or
 * FeatureFlagGuard. It must always accept provider retries even while
 * payments.purchases_enabled=false, so integration testing against the
 * (mock, for now) processor doesn't fail loudly. Authenticity is
 * established entirely by the HMAC signature check inside
 * PaymentsService.handleWebhook. Requires `rawBody: true` on
 * NestFactory.create (see src/main.ts).
 */
@Controller('payments/webhook')
export class PaymentsWebhookController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post(':providerId')
  async handleWebhook(
    @Param('providerId') providerId: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-payment-signature') signature?: string,
  ) {
    const data = await this.paymentsService.handleWebhook(providerId, req.rawBody, signature);
    return { data };
  }
}
