import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { VipService } from './vip.service';
import { CreateVipLevelDto, UpdateVipLevelDto } from './dto/vip-level.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentAdminId } from '../../common/decorators/current-admin.decorator';
import { PrismaService } from '../../prisma/prisma.service';

/** Admin-only: full ladder CRUD incl. multipliers/minPoints/benefits/reward configs. */
@Controller('admin/vip/levels')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminVipController {
  constructor(
    private readonly vipService: VipService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @RequirePermission('vip.manage')
  async list() {
    const data = await this.vipService.listLevelsAdmin();
    return { data };
  }

  @Get(':id')
  @RequirePermission('vip.manage')
  async getOne(@Param('id') id: string) {
    const data = await this.vipService.getLevelAdmin(id);
    return { data };
  }

  @Post()
  @RequirePermission('vip.manage')
  async create(@Body() dto: CreateVipLevelDto, @CurrentAdminId() adminId: string) {
    const created = await this.vipService.createLevel(dto as unknown as Prisma.VipLevelCreateInput);

    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: 'vip.level.create',
        targetType: 'vip_level',
        targetId: created.id,
        oldState: Prisma.JsonNull,
        newState: created as unknown as object,
        reason: 'VIP level created via admin API',
      },
    });

    return { data: created };
  }

  @Patch(':id')
  @RequirePermission('vip.manage')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateVipLevelDto,
    @CurrentAdminId() adminId: string,
  ) {
    const before = await this.vipService.getLevelAdmin(id);
    const updated = await this.vipService.updateLevel(id, dto as unknown as Prisma.VipLevelUpdateInput);

    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: 'vip.level.update',
        targetType: 'vip_level',
        targetId: id,
        oldState: before as unknown as object,
        newState: updated as unknown as object,
        reason: 'VIP level updated via admin API',
      },
    });

    return { data: updated };
  }
}
