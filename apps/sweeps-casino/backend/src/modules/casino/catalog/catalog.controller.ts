import { Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AuthenticatedUser, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { CatalogService } from './catalog.service';
import { ListGamesQueryDto } from './dto/list-games.dto';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

@Controller('casino')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('sections')
  @UseGuards(OptionalJwtAuthGuard)
  async getSections(@CurrentUser() user: AuthenticatedUser | undefined) {
    const sections = await this.catalogService.getSections(user?.userId);
    return { data: sections };
  }

  @Get('games')
  async listGames(@Query() query: ListGamesQueryDto) {
    const result = await this.catalogService.listGames(query);
    return { data: result.games, meta: { nextCursor: result.nextCursor } };
  }

  @Get('recently-played')
  @UseGuards(JwtAuthGuard)
  async recentlyPlayed(@CurrentUser() user: AuthenticatedUser) {
    const rows = await this.catalogService.getRecentlyPlayed(user.userId);
    return { data: rows };
  }

  @Get('games/:slug')
  async getGame(@Param('slug') slug: string) {
    const game = await this.catalogService.getGameBySlug(slug);
    return { data: game };
  }

  @Post('favorites/:gameId')
  @UseGuards(JwtAuthGuard)
  async addFavorite(@CurrentUser() user: AuthenticatedUser, @Param('gameId') gameId: string) {
    const result = await this.catalogService.toggleFavorite(user.userId, gameId, true);
    return { data: result };
  }

  @Delete('favorites/:gameId')
  @UseGuards(JwtAuthGuard)
  async removeFavorite(@CurrentUser() user: AuthenticatedUser, @Param('gameId') gameId: string) {
    const result = await this.catalogService.toggleFavorite(user.userId, gameId, false);
    return { data: result };
  }
}
