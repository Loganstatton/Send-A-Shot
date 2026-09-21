import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { PromotionsService } from './promotions.service';
import { CreateAmoeRequestDto } from './dto/amoe.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('amoe')
@UseGuards(JwtAuthGuard)
export class AmoeController {
  constructor(private readonly promotionsService: PromotionsService) {}

  @Post('requests')
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAmoeRequestDto) {
    const data = await this.promotionsService.createAmoeRequest(user.userId, dto);
    return { data };
  }

  @Get('requests')
  async list(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.promotionsService.listAmoeRequests(user.userId);
    return { data };
  }
}
