import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { OptionalJwtAuthGuard } from '../catalog/optional-jwt-auth.guard';
import { AuthenticatedUser, CurrentUser } from '../../../common/decorators/current-user.decorator';

type ActivityTab = 'all' | 'big-wins' | 'lucky-wins' | 'mine';

/**
 * Player activity feed (spec §14). Read-only aggregate over settled
 * GameRounds — reaches into GameRound/Game/User directly (the same
 * pragmatic cross-domain-read exception other modules' `/me` and
 * `/admin/dashboard` endpoints already use) rather than routing through
 * WalletModule/UserModule for a feed that's fundamentally a join across
 * casino + identity, not a mutation.
 */
@Controller('activity')
@UseGuards(OptionalJwtAuthGuard)
export class ActivityController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Query('tab') tab: ActivityTab = 'all',
    @Query('cursor') cursor?: string,
    @Query('limit') limitParam?: string,
  ) {
    const limit = Math.min(Number(limitParam) || 30, 50);

    const where: Record<string, unknown> = { status: 'SETTLED' };
    let orderBy: Record<string, 'asc' | 'desc'> = { settledAt: 'desc' };

    if (tab === 'mine') {
      if (!user) {
        return { data: { items: [], nextCursor: null } };
      }
      where.userId = user.userId;
    } else if (tab === 'big-wins') {
      where.winAmount = { gt: 0 };
      orderBy = { winAmount: 'desc' };
    } else if (tab === 'lucky-wins') {
      where.multiplier = { gt: 1 };
      orderBy = { multiplier: 'desc' };
    }

    const rounds = await this.prisma.gameRound.findMany({
      where,
      orderBy,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        game: { select: { name: true } },
        user: { select: { username: true, displayNameMasked: true } },
      },
    });

    const hasMore = rounds.length > limit;
    const page = hasMore ? rounds.slice(0, limit) : rounds;

    const items = page.map((r) => ({
      id: r.id,
      gameId: r.gameId,
      gameName: r.game.name,
      displayName: r.user.displayNameMasked ? maskName(r.user.username) : r.user.username,
      amount: Number(r.winAmount ?? 0),
      multiplier: Number(r.multiplier ?? 0),
      currency: r.currency,
      tab,
      createdAt: (r.settledAt ?? r.createdAt).toISOString(),
    }));

    return { data: { items, nextCursor: hasMore ? page[page.length - 1].id : null } };
  }
}

function maskName(name: string): string {
  if (name.length <= 2) return `${name[0] ?? ''}*`;
  return `${name[0]}${'*'.repeat(name.length - 2)}${name[name.length - 1]}`;
}
