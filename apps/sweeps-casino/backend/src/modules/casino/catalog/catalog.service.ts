import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CatalogSort, ListGamesQueryDto } from './dto/list-games.dto';

const SECTION_TAKE = 12;

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  private buildOrderBy(sort?: CatalogSort): Prisma.GameOrderByWithRelationInput[] {
    switch (sort) {
      case 'new':
        return [{ createdAt: 'desc' }];
      case 'name':
        return [{ name: 'asc' }];
      case 'featured':
      default:
        return [{ sortWeight: 'desc' }, { createdAt: 'desc' }];
    }
  }

  async listGames(query: ListGamesQueryDto) {
    const limit = Math.min(query.limit ?? 24, 100);
    const where: Prisma.GameWhereInput = {
      status: 'ACTIVE',
      ...(query.category ? { category: query.category } : {}),
      ...(query.tag ? { tags: { has: query.tag } } : {}),
      ...(query.provider ? { provider: { code: query.provider } } : {}),
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
    };

    const games = await this.prisma.game.findMany({
      where,
      orderBy: this.buildOrderBy(query.sort),
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { provider: true },
    });

    const hasMore = games.length > limit;
    const page = hasMore ? games.slice(0, limit) : games;
    return { games: page, nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  async getGameBySlug(slug: string) {
    const game = await this.prisma.game.findUnique({ where: { slug }, include: { provider: true } });
    if (!game) {
      throw new NotFoundException({ code: 'GAME_NOT_FOUND', message: 'Game not found.' });
    }
    return game;
  }

  /**
   * Home lobby sections. Only real provider seeded in Phase 1 is internal
   * Originals, so "Trending" / "New Releases" are honest different sort
   * orders over the same Game table (sortWeight desc / createdAt desc)
   * rather than fabricated engagement data — there's no play-count/view
   * telemetry yet to rank by.
   */
  async getSections(userId?: string) {
    const [originals, trending, newReleases, recentlyPlayed, favorites] = await Promise.all([
      this.prisma.game.findMany({
        where: { status: 'ACTIVE', category: 'ORIGINALS' },
        orderBy: [{ sortWeight: 'desc' }, { createdAt: 'desc' }],
        take: SECTION_TAKE,
        include: { provider: true },
      }),
      this.prisma.game.findMany({
        where: { status: 'ACTIVE' },
        orderBy: [{ sortWeight: 'desc' }, { createdAt: 'desc' }],
        take: SECTION_TAKE,
        include: { provider: true },
      }),
      this.prisma.game.findMany({
        where: { status: 'ACTIVE' },
        orderBy: [{ createdAt: 'desc' }],
        take: SECTION_TAKE,
        include: { provider: true },
      }),
      userId
        ? this.prisma.recentlyPlayed.findMany({
            where: { userId },
            orderBy: { lastPlayedAt: 'desc' },
            take: SECTION_TAKE,
            include: { game: { include: { provider: true } } },
          })
        : Promise.resolve([]),
      userId
        ? this.prisma.favorite.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: SECTION_TAKE,
            include: { game: { include: { provider: true } } },
          })
        : Promise.resolve([]),
    ]);

    return [
      { key: 'recently-played', title: 'Recently Played', games: recentlyPlayed.map((r) => r.game) },
      { key: 'favorites', title: 'Favorites', games: favorites.map((f) => f.game) },
      { key: 'originals', title: 'Originals', games: originals },
      { key: 'trending', title: 'Trending', games: trending },
      { key: 'new-releases', title: 'New Releases', games: newReleases },
    ];
  }

  async toggleFavorite(userId: string, gameId: string, favorite: boolean) {
    const game = await this.prisma.game.findUnique({ where: { id: gameId } });
    if (!game) {
      throw new NotFoundException({ code: 'GAME_NOT_FOUND', message: 'Game not found.' });
    }

    if (favorite) {
      await this.prisma.favorite.upsert({
        where: { userId_gameId: { userId, gameId } },
        create: { userId, gameId },
        update: {},
      });
    } else {
      await this.prisma.favorite.deleteMany({ where: { userId, gameId } });
    }

    return { gameId, favorite };
  }

  async getRecentlyPlayed(userId: string) {
    return this.prisma.recentlyPlayed.findMany({
      where: { userId },
      orderBy: { lastPlayedAt: 'desc' },
      take: 50,
      include: { game: { include: { provider: true } } },
    });
  }
}
