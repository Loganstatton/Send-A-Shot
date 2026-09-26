import { Controller, Headers, Param, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { KycService } from './kyc.service';

/**
 * Provider callback endpoint — intentionally NOT behind JwtAuthGuard (the
 * caller is the KYC vendor, not a logged-in user). Authenticity is
 * established entirely by the HMAC signature check inside
 * KycService.handleWebhook. Requires `rawBody: true` on NestFactory.create
 * (see src/main.ts) so `req.rawBody` holds the exact bytes the signature
 * was computed over.
 */
@Controller('kyc/webhook')
export class KycWebhookController {
  constructor(private readonly kycService: KycService) {}

  @Post(':providerId')
  async handleWebhook(
    @Param('providerId') providerId: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-kyc-signature') signature?: string,
  ) {
    const data = await this.kycService.handleWebhook(providerId, req.rawBody, signature);
    return { data };
  }
}
