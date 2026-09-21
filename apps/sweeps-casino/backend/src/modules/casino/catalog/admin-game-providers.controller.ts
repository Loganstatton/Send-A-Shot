import { Body, Controller, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../../common/guards/admin.guard';
import { RequirePermission } from '../../../common/decorators/permissions.decorator';
import { CurrentAdminId } from '../../../common/decorators/current-admin.decorator';
import { AdminCreateGameProviderDto, AdminUpdateGameProviderDto } from './dto/admin-catalog.dto';

@Controller('admin/game-providers')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminGameProvidersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('games.manage')
  async list() {
    const providers = await this.prisma.gameProvider.findMany({ orderBy: { name: 'asc' } });
    return { data: providers };
  }

  @Get(':id')
  @RequirePermission('games.manage')
  async getOne(@Param('id') id: string) {
    const provider = await this.prisma.gameProvider.findUnique({ where: { id } });
    if (!provider) {
      throw new NotFoundException({ code: 'PROVIDER_NOT_FOUND', message: 'Game provider not found.' });
    }
    return { data: provider };
  }

  @Post()
  @RequirePermission('games.manage')
  async create(@Body() dto: AdminCreateGameProviderDto, @CurrentAdminId() adminId: string) {
    const created = await this.prisma.gameProvider.create({ data: { ...dto } });

    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: 'game_providers.create',
        targetType: 'game_provider',
        targetId: created.id,
        newState: created as unknown as object,
      },
    });

    return { data: created };
  }

  @Patch(':id')
  @RequirePermission('games.manage')
  async update(
    @Param('id') id: string,
    @Body() dto: AdminUpdateGameProviderDto,
    @CurrentAdminId() adminId: string,
  ) {
    const before = await this.prisma.gameProvider.findUnique({ where: { id } });
    if (!before) {
      throw new NotFoundException({ code: 'PROVIDER_NOT_FOUND', message: 'Game provider not found.' });
    }

    const updated = await this.prisma.gameProvider.update({ where: { id }, data: { ...dto } });

    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: 'game_providers.update',
        targetType: 'game_provider',
        targetId: id,
        oldState: before as unknown as object,
        newState: updated as unknown as object,
      },
    });

    return { data: updated };
  }
}
