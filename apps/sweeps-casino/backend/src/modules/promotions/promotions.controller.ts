import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { PromotionType } from '@prisma/client';
import { PromotionsService } from './promotions.service';
import { RedeemCodeDto } from './dto/promotion.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { IdempotencyKey } from '../../common/decorators/idempotency-key.decorator';

@Controller('promotions')
@UseGuards(JwtAuthGuard)
export class PromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('type') type?: PromotionType,
    // `status` is accepted per docs/05-api-design.md's example query
    // (?type=&status=active) but this listing is always constrained to
    // ACTIVE + eligible-for-this-user — there's no player-facing view of
    // DRAFT/PAUSED/ENDED promotions, so any other value is a no-op.
    @Query('status') _status?: string,
  ) {
    const data = await this.promotionsService.listForUser(user.userId, { type });
    return { data };
  }

  @Get('daily-bonus')
  async getDailyBonus(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.promotionsService.getDailyBonusState(user.userId);
    return { data };
  }

  @Post('daily-bonus/claim')
  async claimDailyBonus(
    @CurrentUser() user: AuthenticatedUser,
    // Required by contract (mutating money-adjacent endpoint); the actual
    // wallet-level dedup uses a deterministic key derived from
    // (promotionId, userId, claimSequence) — see PromotionsService.performClaim.
    @IdempotencyKey() _idempotencyKey: string,
  ) {
    const data = await this.promotionsService.claimDailyBonus(user.userId);
    return { data };
  }

  @Post('codes/redeem')
  async redeemCode(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RedeemCodeDto,
    @IdempotencyKey() _idempotencyKey: string,
  ) {
    const data = await this.promotionsService.redeemCode(user.userId, dto.code);
    return { data };
  }

  @Get('claims')
  async listClaims(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.promotionsService.listClaims(user.userId);
    return { data };
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    const data = await this.promotionsService.getById(id);
    return { data };
  }

  @Post(':id/claim')
  async claim(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @IdempotencyKey() _idempotencyKey: string,
  ) {
    const data = await this.promotionsService.claimPromotionById(user.userId, id);
    return { data };
  }
}
