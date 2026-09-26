import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PaymentStatus, PaymentType } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RequirePermission } from '../../common/decorators/permissions.decorator';

@Controller('admin/payments')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminPaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  @RequirePermission('payments.view')
  async list(
    @Query('status') status?: PaymentStatus,
    @Query('type') type?: PaymentType,
    @Query('userId') userId?: string,
  ) {
    const data = await this.paymentsService.adminList({ status, type, userId });
    return { data };
  }
}
