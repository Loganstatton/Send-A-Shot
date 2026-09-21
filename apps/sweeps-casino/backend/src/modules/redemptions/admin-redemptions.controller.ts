import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { RedemptionStatus } from '@prisma/client';
import { RedemptionsService } from './redemptions.service';
import { RedemptionDecisionDto } from './dto/redemption-decision.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentAdminId } from '../../common/decorators/current-admin.decorator';

@Controller('admin/redemptions')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminRedemptionsController {
  constructor(private readonly redemptionsService: RedemptionsService) {}

  @Get()
  @RequirePermission('redemptions.decide')
  async list(@Query('status') status?: RedemptionStatus) {
    const data = await this.redemptionsService.adminList(status);
    return { data };
  }

  @Post(':id/decision')
  @RequirePermission('redemptions.decide')
  async decide(
    @Param('id') id: string,
    @Body() dto: RedemptionDecisionDto,
    @CurrentAdminId() adminId: string,
  ) {
    const data = await this.redemptionsService.decide(id, dto, adminId);
    return { data };
  }
}
