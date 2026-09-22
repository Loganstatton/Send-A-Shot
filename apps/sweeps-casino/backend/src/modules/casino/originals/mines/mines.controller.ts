import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { AuthenticatedUser, CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { IdempotencyKey } from '../../../../common/decorators/idempotency-key.decorator';
import { MinesRoundService } from './mines-round.service';
import { StartMinesRoundDto } from './dto/start-round.dto';
import { PickTileDto } from './dto/pick-tile.dto';

/**
 * The real, interactive Mines flow: start a round (bet debited once,
 * mine layout derived + held server-side), pick tiles one at a time
 * (each safe pick raises the live multiplier; a mine ends the round), and
 * cash out whenever at least one safe pick has landed (credits the
 * current multiplier's payout and settles the round).
 *
 * Deliberately NOT routed through the generic OriginalsController's
 * `casino/originals/:game/play` single-shot endpoint — that endpoint (and
 * OriginalsService/OriginalsPlayDto) stays completely untouched for
 * dice/plinko, which are still single-shot games. This controller is
 * registered on the literal `casino/originals/mines` path, which never
 * collides with `casino/originals/:game/{config,play,history}` (different
 * literal sub-path segments), so route registration order relative to
 * OriginalsController doesn't matter here the way it does for
 * OriginalsSeedsController.
 */
@Controller('casino/originals/mines')
@UseGuards(JwtAuthGuard)
export class MinesController {
  constructor(private readonly minesRoundService: MinesRoundService) {}

  @Post('start')
  async start(
    @IdempotencyKey() idempotencyKey: string,
    @Body() dto: StartMinesRoundDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const data = await this.minesRoundService.start(user.userId, idempotencyKey, dto);
    return { data };
  }

  @Post(':roundId/pick')
  async pick(
    @Param('roundId') roundId: string,
    @IdempotencyKey() idempotencyKey: string,
    @Body() dto: PickTileDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const data = await this.minesRoundService.pick(user.userId, roundId, idempotencyKey, dto.tileIndex);
    return { data };
  }

  @Post(':roundId/cashout')
  async cashout(
    @Param('roundId') roundId: string,
    @IdempotencyKey() idempotencyKey: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const data = await this.minesRoundService.cashout(user.userId, roundId, idempotencyKey);
    return { data };
  }
}
