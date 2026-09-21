import { Body, Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ResolveRiskEventDto } from './dto/resolve-risk-event.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentAdminId } from '../../common/decorators/current-admin.decorator';

@Controller('admin/risk')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminRiskController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('events')
  @RequirePermission('risk.view')
  async events(@Query('userId') userId?: string, @Query('resolved') resolved?: string) {
    const where: Prisma.RiskEventWhereInput = {};
    if (userId) where.userId = userId;
    if (resolved === 'true') where.resolvedAt = { not: null };
    if (resolved === 'false') where.resolvedAt = null;

    const data = await this.prisma.riskEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return { data };
  }

  @Post('events/:id/resolve')
  @RequirePermission('risk.resolve')
  async resolve(
    @Param('id') id: string,
    @Body() dto: ResolveRiskEventDto,
    @CurrentAdminId() adminId: string,
  ) {
    const event = await this.prisma.riskEvent.findUnique({ where: { id } });
    if (!event) {
      throw new NotFoundException({ code: 'RISK_EVENT_NOT_FOUND', message: 'Risk event not found.' });
    }

    const data = await this.prisma.$transaction(async (tx) => {
      const rec = await tx.riskEvent.update({
        where: { id },
        data: { resolvedBy: adminId, resolvedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          adminId,
          action: 'risk.resolve_event',
          targetType: 'risk_event',
          targetId: id,
          oldState: { resolvedAt: event.resolvedAt } as object,
          newState: { resolvedAt: rec.resolvedAt } as object,
          reason: dto.reason,
        },
      });
      return rec;
    });

    return { data };
  }
}
