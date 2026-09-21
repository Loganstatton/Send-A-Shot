import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { GameCategory, GameStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../../common/guards/admin.guard';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import { CurrentAdminId } from '../../../common/decorators/current-admin.decorator';
import { AdminCreateGameDto, AdminUpdateGameDto } from './dto/admin-catalog.dto';

/**
 * Admin catalog management (activate/deactivate, feature via sortWeight,
 * tag, jurisdiction-restrict, maintenance) — see docs/05-api-design.md
 * Admin API §Games. CASINO owns the `games` table per docs/01-architecture.md
 * §3, so this controller lives in the casino module rather than the
 * separate ADMIN module.
 */
@Controller('admin/games')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminGamesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('games.manage')
  async list(@Query('category') category?: GameCategory, @Query('status') status?: GameStatus) {
    const games = await this.prisma.game.findMany({
      where: {
        ...(category ? { category } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: [{ sortWeight: 'desc' }, { createdAt: 'desc' }],
      include: { provider: true },
    });
    return { data: games };
  }

  @Get(':id')
  @RequirePermission('games.manage')
  async getOne(@Param('id') id: string) {
    const game = await this.prisma.game.findUnique({ where: { id }, include: { provider: true } });
    if (!game) {
      throw new NotFoundException({ code: 'GAME_NOT_FOUND', message: 'Game not found.' });
    }
    return { data: game };
  }

  @Post()
  @RequirePermission('games.manage')
  async create(@Body() dto: AdminCreateGameDto, @CurrentAdminId() adminId: string) {
    const created = await this.prisma.game.create({ data: { ...dto } });

    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: 'games.create',
        targetType: 'game',
        targetId: created.id,
        newState: created as unknown as object,
      },
    });

    return { data: created };
  }

  @Patch(':id')
  @RequirePermission('games.manage')
  async update(@Param('id') id: string, @Body() dto: AdminUpdateGameDto, @CurrentAdminId() adminId: string) {
    const before = await this.prisma.game.findUnique({ where: { id } });
    if (!before) {
      throw new NotFoundException({ code: 'GAME_NOT_FOUND', message: 'Game not found.' });
    }

    const updated = await this.prisma.game.update({ where: { id }, data: { ...dto } });

    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: 'games.update',
        targetType: 'game',
        targetId: id,
        oldState: before as unknown as object,
        newState: updated as unknown as object,
      },
    });

    return { data: updated };
  }
}
