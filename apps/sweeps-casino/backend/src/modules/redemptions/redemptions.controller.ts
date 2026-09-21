import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { RedemptionsService } from './redemptions.service';
import { CreateRedemptionDto } from './dto/create-redemption.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { FeatureFlagGuard, RequireFeatureFlag } from '../../common/guards/feature-flag.guard';
import { JurisdictionGuard, RequireJurisdiction } from '../../common/guards/jurisdiction.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('redemptions')
@UseGuards(JwtAuthGuard)
export class RedemptionsController {
  constructor(private readonly redemptionsService: RedemptionsService) {}

  /** Never flag-gated — explains which gate is blocking even while disabled. Must come before ':id'. */
  @Get('eligibility')
  async eligibility(@CurrentUser() user: AuthenticatedUser, @Query('amount') amount?: string) {
    const data = await this.redemptionsService.getEligibility(user.userId, amount);
    return { data };
  }

  @Post()
  @UseGuards(FeatureFlagGuard, JurisdictionGuard)
  @RequireFeatureFlag('redemptions.enabled')
  @RequireJurisdiction('REDEMPTION')
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateRedemptionDto) {
    const data = await this.redemptionsService.create(user.userId, dto);
    return { data };
  }

  @Get()
  @UseGuards(FeatureFlagGuard)
  @RequireFeatureFlag('redemptions.enabled')
  async list(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.redemptionsService.list(user.userId);
    return { data };
  }

  @Get(':id')
  @UseGuards(FeatureFlagGuard)
  @RequireFeatureFlag('redemptions.enabled')
  async getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const data = await this.redemptionsService.getOwn(user.userId, id);
    return { data };
  }

  @Post(':id/cancel')
  @UseGuards(FeatureFlagGuard)
  @RequireFeatureFlag('redemptions.enabled')
  async cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const data = await this.redemptionsService.cancel(user.userId, id);
    return { data };
  }
}
