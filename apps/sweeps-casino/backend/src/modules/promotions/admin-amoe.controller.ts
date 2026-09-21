import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { PromotionsService } from './promotions.service';
import { AdminAmoeDecisionDto } from './dto/amoe.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentAdminId } from '../../common/decorators/current-admin.decorator';

@Controller('admin/amoe/requests')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminAmoeController {
  constructor(private readonly promotionsService: PromotionsService) {}

  @Get()
  @RequirePermission('promotions.manage')
  async list(@Query('status') status?: string) {
    const data = await this.promotionsService.listAmoeRequestsAdmin({ status });
    return { data };
  }

  @Get(':id')
  @RequirePermission('promotions.manage')
  async getOne(@Param('id') id: string) {
    const data = await this.promotionsService.getAmoeRequestAdmin(id);
    return { data };
  }

  @Patch(':id')
  @RequirePermission('promotions.manage')
  async decide(
    @Param('id') id: string,
    @Body() dto: AdminAmoeDecisionDto,
    @CurrentAdminId() adminId: string,
  ) {
    const data = await this.promotionsService.decideAmoeRequest(id, adminId, dto);
    return { data };
  }
}
