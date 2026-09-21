import { Controller, Get, UseGuards } from '@nestjs/common';
import { VipService } from './vip.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('vip')
export class VipController {
  constructor(private readonly vipService: VipService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.vipService.getMe(user.userId);
    return { data };
  }

  /** Public ladder: names/benefits only — internal point formulas stay admin-only. */
  @Get('levels')
  async getLevels() {
    const data = await this.vipService.listLevelsPublic();
    return { data };
  }

  @Get('rewards')
  @UseGuards(JwtAuthGuard)
  async getRewards(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.vipService.getRewards(user.userId);
    return { data };
  }
}
