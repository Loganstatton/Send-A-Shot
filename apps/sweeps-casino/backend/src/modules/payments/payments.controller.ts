import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CheckoutDto } from './dto/checkout.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { FeatureFlagGuard, RequireFeatureFlag } from '../../common/guards/feature-flag.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { IdempotencyKey } from '../../common/decorators/idempotency-key.decorator';

@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /** Not flag-gated — harmless to show even while purchases are disabled. */
  @Get('packages')
  async packages() {
    const data = await this.paymentsService.listPackages();
    return { data };
  }

  @Post('checkout')
  @UseGuards(FeatureFlagGuard)
  @RequireFeatureFlag('payments.purchases_enabled')
  async checkout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CheckoutDto,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    const data = await this.paymentsService.checkout(user.userId, dto, idempotencyKey);
    return { data };
  }

  /** Not flag-gated — a user's own purchase history stays visible/empty while disabled. */
  @Get('history')
  async history(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.paymentsService.history(user.userId);
    return { data };
  }
}
