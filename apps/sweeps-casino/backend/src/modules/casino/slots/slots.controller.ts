import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AuthenticatedUser, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { IdempotencyKey } from '../../../common/decorators/idempotency-key.decorator';
import { SlotsService } from './slots.service';
import { SlotSpinDto } from './dto/slot-spin.dto';
import { HistoryQueryDto } from '../originals/dto/history-query.dto';

@Controller('casino/slots/:game')
@UseGuards(JwtAuthGuard)
export class SlotsController {
  constructor(private readonly slotsService: SlotsService) {}

  @Get('config')
  async getConfig(@Param('game') game: string, @CurrentUser() user: AuthenticatedUser) {
    const data = await this.slotsService.getConfig(user.userId, game);
    return { data };
  }

  @Post('spin')
  async spin(
    @Param('game') game: string,
    @IdempotencyKey() idempotencyKey: string,
    @Body() dto: SlotSpinDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const data = await this.slotsService.spin(user.userId, game, idempotencyKey, dto);
    return { data };
  }

  @Get('history')
  async history(
    @Param('game') game: string,
    @Query() query: HistoryQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.slotsService.getHistory(user.userId, game, query);
    return { data: result.rounds, meta: { nextCursor: result.nextCursor } };
  }
}
