import { Body, Controller, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AuthenticatedUser, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { IdempotencyKey } from '../../../common/decorators/idempotency-key.decorator';
import { SlotsService } from './slots.service';
import { SlotSpinDto } from './dto/slot-spin.dto';
import { DEV_SCENARIOS } from './engine/dev-fixtures';

/**
 * Developer-only forced-result fixtures (spec: "DEMO MODE... via
 * developer-only forced-result fixtures. These controls must NEVER exist
 * in production player APIs"). Every route 404s unless NODE_ENV is
 * anything other than 'production' — checked per-request, not just at
 * module-load, so there's no way to flip an env var after boot and get a
 * stale "enabled" state. This still runs real bets/credits through the
 * exact same ledger code as the real endpoint (see SlotsService.devSpin) —
 * only the RNG input is substituted — so it's a legitimate way to exercise
 * the bonus/big-win paths against a real (dev/demo) wallet, never a way to
 * skip money movement.
 */
@Controller('casino/slots/:game/dev')
@UseGuards(JwtAuthGuard)
export class SlotsDevController {
  constructor(private readonly slotsService: SlotsService) {}

  private assertNonProduction() {
    if (process.env.NODE_ENV === 'production') {
      throw new NotFoundException();
    }
  }

  @Post('spin/:scenario')
  async devSpin(
    @Param('game') game: string,
    @Param('scenario') scenario: string,
    @IdempotencyKey() idempotencyKey: string,
    @Body() dto: SlotSpinDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    this.assertNonProduction();
    if (!DEV_SCENARIOS.includes(scenario as (typeof DEV_SCENARIOS)[number])) {
      throw new NotFoundException({ code: 'UNKNOWN_SCENARIO', message: `Unknown scenario '${scenario}'.` });
    }
    const data = await this.slotsService.devSpin(user.userId, game, idempotencyKey, dto, scenario);
    return { data };
  }

  @Post('scenarios')
  async listScenarios() {
    this.assertNonProduction();
    return { data: DEV_SCENARIOS };
  }
}
