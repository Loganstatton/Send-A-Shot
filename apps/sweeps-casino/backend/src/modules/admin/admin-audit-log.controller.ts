import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminAuditLogService } from './admin-audit-log.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RequirePermission } from '../../common/decorators/permissions.decorator';

@Controller('admin/audit-log')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminAuditLogController {
  constructor(private readonly adminAuditLogService: AdminAuditLogService) {}

  @Get()
  @RequirePermission('admin.audit_log.view')
  async list(
    @Query('actor') actor?: string,
    @Query('target') target?: string,
    @Query('action') action?: string,
    @Query('cursor') cursor?: string,
  ) {
    const result = await this.adminAuditLogService.list({ actor, target, action, cursor });
    return { data: result.entries, meta: { nextCursor: result.nextCursor } };
  }
}
