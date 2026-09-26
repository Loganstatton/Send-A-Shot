import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AuthenticatedUser, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { OriginalsService } from './originals.service';
import { RotateSeedDto, UpdateClientSeedDto } from './dto/seed.dto';

/**
 * Registered ahead of OriginalsController (see casino.module.ts) so the
 * static 'casino/originals/seeds...' routes are matched before
 * 'casino/originals/:game/...' could ever treat "seeds" as a game name.
 */
@Controller('casino/originals/seeds')
@UseGuards(JwtAuthGuard)
export class OriginalsSeedsController {
  constructor(private readonly originalsService: OriginalsService) {}

  @Get()
  async getSeeds(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.originalsService.getSeeds(user.userId);
    return { data };
  }

  @Post('rotate')
  async rotate(@Body() dto: RotateSeedDto, @CurrentUser() user: AuthenticatedUser) {
    const data = await this.originalsService.rotateSeed(user.userId, dto.newClientSeed);
    return { data };
  }

  @Patch('client-seed')
  async updateClientSeed(@Body() dto: UpdateClientSeedDto, @CurrentUser() user: AuthenticatedUser) {
    const data = await this.originalsService.updateClientSeed(user.userId, dto.clientSeed);
    return { data };
  }
}
