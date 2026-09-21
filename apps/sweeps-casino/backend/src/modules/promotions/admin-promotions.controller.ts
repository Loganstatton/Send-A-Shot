import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PromotionType } from '@prisma/client';
import { PromotionsService } from './promotions.service';
import { CreatePromotionDto, UpdatePromotionDto } from './dto/promotion.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentAdminId } from '../../common/decorators/current-admin.decorator';
import { PrismaService } from '../../prisma/prisma.service';

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
        newState: created as unknown as object,
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
        oldState: before as unknown as object,
        newState: updated as unknown as object,
        reason: 'Promotion updated via admin API',
      },
    });

    return { data: updated };
  }
}
