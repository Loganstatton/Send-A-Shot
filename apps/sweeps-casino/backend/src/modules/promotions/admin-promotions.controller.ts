import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Prisma, PromotionType } from '@prisma/client';
import { PromotionsService } from './promotions.service';
import { CreatePromotionDto, UpdatePromotionDto } from './dto/promotion.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentAdminId } from '../../common/decorators/current-admin.decorator';
import { PrismaService } from '../../prisma/prisma.service';

/** Round-trips a Prisma model (which may carry Decimal/Date fields) through
 * JSON so it's a plain, Prisma-Json-safe value before writing it into an
 * audit_logs.old_state/new_state jsonb column. */
function toJsonSafe(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

@Controller('admin/promotions')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminPromotionsController {
  constructor(
    private readonly promotionsService: PromotionsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @RequirePermission('promotions.manage')
  async list(@Query('type') type?: PromotionType, @Query('status') status?: string) {
    const data = await this.promotionsService.listAdmin({ type, status });
    return { data };
  }

  @Get(':id')
  @RequirePermission('promotions.manage')
  async getOne(@Param('id') id: string) {
    const data = await this.promotionsService.getAdmin(id);
    return { data };
  }

  @Post()
  @RequirePermission('promotions.manage')
  async create(@Body() dto: CreatePromotionDto, @CurrentAdminId() adminId: string) {
    const created = await this.promotionsService.createAdmin(dto, adminId);

    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: 'promotion.create',
        targetType: 'promotion',
        targetId: created.id,
        newState: toJsonSafe(created),
        reason: 'Promotion created via admin API',
      },
    });

    return { data: created };
  }

  @Patch(':id')
  @RequirePermission('promotions.manage')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePromotionDto,
    @CurrentAdminId() adminId: string,
  ) {
    const before = await this.promotionsService.getAdmin(id);
    const updated = await this.promotionsService.updateAdmin(id, dto);

    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: 'promotion.update',
        targetType: 'promotion',
        targetId: id,
        oldState: toJsonSafe(before),
        newState: toJsonSafe(updated),
        reason: 'Promotion updated via admin API',
      },
    });

    return { data: updated };
  }
}
