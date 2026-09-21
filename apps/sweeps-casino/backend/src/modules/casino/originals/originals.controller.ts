import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AuthenticatedUser, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { IdempotencyKey } from '../../../common/decorators/idempotency-key.decorator';
import { OriginalsService } from './originals.service';
import { OriginalsPlayDto } from './dto/originals-play.dto';
import { HistoryQueryDto } from './dto/history-query.dto';

@Controller('casino/originals/:game')
@UseGuards(JwtAuthGuard)
export class OriginalsController {
  constructor(private readonly originalsService: OriginalsService) {}

  @Get('config')
  async getConfig(@Param('game') game: string, @CurrentUser() user: AuthenticatedUser) {
    const data = await this.originalsService.getConfig(user.userId, game);
    return { data };
  }

  @Post('play')
  async play(
    @Param('game') game: string,
    @IdempotencyKey() idempotencyKey: string,
    @Body() dto: OriginalsPlayDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const data = await this.originalsService.play(user.userId, game, idempotencyKey, dto);
    return { data };
  }

  @Get('history')
  async history(
    @Param('game') game: string,
    @Query() query: HistoryQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.originalsService.getHistory(user.userId, game, query);
    return { data: result.rounds, meta: { nextCursor: result.nextCursor } };
  }
}
