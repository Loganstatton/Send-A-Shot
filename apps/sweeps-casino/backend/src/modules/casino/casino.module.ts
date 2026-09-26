import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { WalletModule } from '../wallet/wallet.module';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { AdminGamesController } from './catalog/admin-games.controller';
import { AdminGameProvidersController } from './catalog/admin-game-providers.controller';
import { OptionalJwtAuthGuard } from './catalog/optional-jwt-auth.guard';
import { OriginalsController } from './originals/originals.controller';
import { OriginalsSeedsController } from './originals/originals-seeds.controller';
import { OriginalsService } from './originals/originals.service';
import { MinesController } from './originals/mines/mines.controller';
import { MinesRoundService } from './originals/mines/mines-round.service';
import { ActivityController } from './activity/activity.controller';
import { SlotsController } from './slots/slots.controller';
import { SlotsDevController } from './slots/slots-dev.controller';
import { SlotsService } from './slots/slots.service';

@Module({
  imports: [
    // Local JwtModule registration (mirrors AuthModule) so OptionalJwtAuthGuard
    // can verify access tokens without the CASINO module reaching into AUTH.
    JwtModule.register({}),
    WalletModule,
  ],
  controllers: [
    AdminGamesController,
    AdminGameProvidersController,
    CatalogController,
    // Registered before OriginalsController so the static
    // 'casino/originals/seeds' routes are never shadowed by the
    // 'casino/originals/:game' param route.
    OriginalsSeedsController,
    // Mines' interactive start/pick/cashout routes (literal
    // 'casino/originals/mines/...' sub-paths distinct from :game's
    // config/play/history) — see mines.controller.ts.
    MinesController,
    OriginalsController,
    ActivityController,
    // Dev-fixtures routes registered before the real SlotsController so
    // 'casino/slots/:game/dev/...' isn't shadowed by :game's own routes.
    SlotsDevController,
    SlotsController,
  ],
  providers: [CatalogService, OriginalsService, MinesRoundService, SlotsService, OptionalJwtAuthGuard],
  exports: [OriginalsService],
})
export class CasinoModule {}
