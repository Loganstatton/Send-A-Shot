import { BadRequestException, Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ComplianceService } from './compliance.service';
import { PatchJurisdictionDto } from './dto/jurisdiction.dto';
import { PatchFeatureFlagDto } from './dto/feature-flag.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentAdminId } from '../../common/decorators/current-admin.decorator';

@Controller('admin/compliance')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Get('jurisdictions')
  @RequirePermission('compliance.jurisdictions.read')
  async listJurisdictions() {
    const data = await this.complianceService.listJurisdictions();
    return { data };
  }

  @Patch('jurisdictions/:state')
  @RequirePermission('compliance.jurisdictions.write')
  async patchJurisdiction(
    @Param('state') state: string,
    @Body() dto: PatchJurisdictionDto,
    @CurrentAdminId() adminId: string,
  ) {
    const data = await this.complianceService.updateJurisdiction(state, dto, adminId);
    return { data };
  }

  @Get('feature-flags')
  @RequirePermission('compliance.flags.read')
  async listFeatureFlags() {
    const data = await this.complianceService.listFeatureFlags();
    return { data };
  }

  @Patch('feature-flags/:key')
  @RequirePermission('compliance.flags.write')
  async patchFeatureFlag(
    @Param('key') key: string,
    @Body() dto: PatchFeatureFlagDto,
    @CurrentAdminId() adminId: string,
  ) {
    const data = await this.complianceService.updateFeatureFlag(key, dto, adminId);
    return { data };
  }

  @Get('config-history')
  // Reuses an already-seeded COMPLIANCE-role permission (config history
  // spans both jurisdiction and feature-flag versions, and RequirePermission
  // only checks one string) rather than introducing a new permission that
  // admin_roles wouldn't yet grant to anyone but SUPER_ADMIN.
  @RequirePermission('compliance.jurisdictions.read')
  async configHistory(@Query('key') key?: string) {
    if (!key) {
      throw new BadRequestException({
        code: 'CONFIG_KEY_REQUIRED',
        message: 'A key query parameter is required, e.g. ?key=jurisdiction:NJ',
      });
    }
    const data = await this.complianceService.getConfigHistory(key);
    return { data };
  }
}
