import { Injectable, NotFoundException } from '@nestjs/common';
import { Game, GameProvider, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CatalogSort, ListGamesQueryDto } from './dto/list-games.dto';

const SECTION_TAKE = 12;

type GameWithProvider = Game & { provider: GameProvider };

/**
 * Flat, frontend-facing game shape. The Prisma `Game` model nests its full
 * `GameProvider` relation (id/code/name/type/status/config) — the client
 * only ever needs the provider's display name, so every catalog endpoint
 * routes through this mapper rather than leaking the raw relation object.
 */
export interface GameDto {
  id: string;
  slug: string;
  name: string;
  provider: string;
  category: string;
  tags: string[];
  rtp: number | null;
  isNew: boolean;
  isHot: boolean;
  isFavorite: boolean;
  thumbSeed: string;
}

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  private toDto(game: GameWithProvider, favoriteGameIds?: Set<string>): GameDto {
    return {
      id: game.id,
      slug: game.slug,
      name: game.name,
      provider: game.provider.name,
      category: game.category,
      tags: game.tags,
      rtp: game.rtpBps != null ? game.rtpBps / 100 : null,
      isNew: game.tags.includes('NEW'),
      isHot: game.tags.includes('HOT'),
      isFavorite: favoriteGameIds?.has(game.id) ?? false,
      thumbSeed: game.slug,
    };
  }

  private async getFavoriteGameIds(userId?: string): Promise<Set<string>> {
    if (!userId) return new Set();
    const rows = await this.prisma.favorite.findMany({ where: { userId }, select: { gameId: true } });
    return new Set(rows.map((r) => r.gameId));
  }

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

  async listGames(query: ListGamesQueryDto, userId?: string) {
    const limit = Math.min(query.limit ?? 24, 100);

    if (query.favoritesOnly && !userId) {
      return { games: [] as GameDto[], nextCursor: null };
    }

    const favoriteGameIds = await this.getFavoriteGameIds(userId);

    const where: Prisma.GameWhereInput = {
      status: 'ACTIVE',
      ...(query.category ? { category: query.category } : {}),
      ...(query.tag ? { tags: { has: query.tag } } : {}),
      ...(query.provider ? { provider: { code: query.provider } } : {}),
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
      ...(query.favoritesOnly ? { id: { in: Array.from(favoriteGameIds) } } : {}),
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
    return {
      games: page.map((g) => this.toDto(g, favoriteGameIds)),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async getGameBySlug(slug: string, userId?: string) {
    const game = await this.prisma.game.findUnique({ where: { slug }, include: { provider: true } });
    if (!game) {
      throw new NotFoundException({ code: 'GAME_NOT_FOUND', message: 'Game not found.' });
    }
    const favoriteGameIds = await this.getFavoriteGameIds(userId);
    return this.toDto(game, favoriteGameIds);
  }

  /**
   * Home lobby sections. Phase 1 has no play-count/view telemetry to rank
   * by, so every "engagement" section below is an honest, documented proxy
   * over the same Game table rather than fabricated data:
   *  - popular: curated via sortWeight (admin-set featured weight)
   *  - trending: tagged HOT, sorted by sortWeight
   *  - new-releases: createdAt desc
   *  - jackpots: tagged JACKPOT
   *  - slots / table-games / live-casino / game-shows: straight category
   *    filters, sortWeight desc. Populated by the Mobile MVP Visual Sprint's
   *    demo catalog (prisma/seed.ts) — real provider integrations replace
   *    this data source, not this method's shape, in a later phase.
   */
  async getSections(userId?: string) {
    const favoriteGameIds = await this.getFavoriteGameIds(userId);

    const featuredOrder: Prisma.GameOrderByWithRelationInput[] = [
      { sortWeight: 'desc' },
      { createdAt: 'desc' },
    ];

    const [
      originals,
      popular,
      trending,
      newReleases,
      slots,
      tableGames,
      liveCasino,
      gameShows,
      jackpots,
      recentlyPlayed,
      favorites,
    ] = await Promise.all([
      this.prisma.game.findMany({
        where: { status: 'ACTIVE', category: 'ORIGINALS' },
        orderBy: featuredOrder,
        take: SECTION_TAKE,
        include: { provider: true },
      }),
      this.prisma.game.findMany({
        where: { status: 'ACTIVE' },
        orderBy: featuredOrder,
        take: SECTION_TAKE,
        include: { provider: true },
      }),
      this.prisma.game.findMany({
        where: { status: 'ACTIVE', tags: { has: 'HOT' } },
        orderBy: featuredOrder,
        take: SECTION_TAKE,
        include: { provider: true },
      }),
      this.prisma.game.findMany({
        where: { status: 'ACTIVE' },
        orderBy: [{ createdAt: 'desc' }],
        take: SECTION_TAKE,
        include: { provider: true },
      }),
      this.prisma.game.findMany({
        where: { status: 'ACTIVE', category: 'SLOTS' },
        orderBy: featuredOrder,
        take: SECTION_TAKE,
        include: { provider: true },
      }),
      this.prisma.game.findMany({
        where: { status: 'ACTIVE', category: 'TABLE_GAMES' },
        orderBy: featuredOrder,
        take: SECTION_TAKE,
        include: { provider: true },
      }),
      this.prisma.game.findMany({
        where: { status: 'ACTIVE', category: 'LIVE_CASINO' },
        orderBy: featuredOrder,
        take: SECTION_TAKE,
        include: { provider: true },
      }),
      this.prisma.game.findMany({
        where: { status: 'ACTIVE', category: 'GAME_SHOWS' },
        orderBy: featuredOrder,
        take: SECTION_TAKE,
        include: { provider: true },
      }),
      this.prisma.game.findMany({
        where: { status: 'ACTIVE', tags: { has: 'JACKPOT' } },
        orderBy: featuredOrder,
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

    const dto = (g: GameWithProvider) => this.toDto(g, favoriteGameIds);

    return [
      { key: 'recently-played', title: 'Recently Played', games: recentlyPlayed.map((r) => dto(r.game)) },
      { key: 'popular', title: 'Popular Now', games: popular.map(dto) },
      { key: 'originals', title: 'Vaultline Originals', games: originals.map(dto) },
      { key: 'trending', title: 'Trending', games: trending.map(dto) },
      { key: 'new-releases', title: 'New Releases', games: newReleases.map(dto) },
      { key: 'slots', title: 'Slots', games: slots.map(dto) },
      { key: 'table-games', title: 'Table Games', games: tableGames.map(dto) },
      { key: 'live-casino', title: 'Live Casino', games: liveCasino.map(dto) },
      { key: 'game-shows', title: 'Game Shows', games: gameShows.map(dto) },
      { key: 'jackpots', title: 'Jackpots', games: jackpots.map(dto) },
      { key: 'favorites', title: 'Favorites', games: favorites.map((f) => dto(f.game)) },
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
    const [rows, favoriteGameIds] = await Promise.all([
      this.prisma.recentlyPlayed.findMany({
        where: { userId },
        orderBy: { lastPlayedAt: 'desc' },
        take: 50,
        include: { game: { include: { provider: true } } },
      }),
      this.getFavoriteGameIds(userId),
    ]);
    return rows.map((r) => this.toDto(r.game, favoriteGameIds));
  }
}
