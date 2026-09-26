import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { KycService } from './kyc.service';
import { KycDecisionDto } from './dto/kyc-decision.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentAdminId } from '../../common/decorators/current-admin.decorator';

@Controller('admin/kyc')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminKycController {
  constructor(private readonly kycService: KycService) {}

  @Get('queue')
  @RequirePermission('kyc.review')
  async queue() {
    const data = await this.kycService.getQueue();
    return { data };
  }

  @Post(':recordId/decision')
  @RequirePermission('kyc.review')
  async decide(
    @Param('recordId') recordId: string,
    @Body() dto: KycDecisionDto,
    @CurrentAdminId() adminId: string,
  ) {
    const data = await this.kycService.decide(recordId, dto, adminId);
    return { data };
  }

  @Get(':recordId/documents/:docId/signed-url')
  @RequirePermission('kyc.view_documents')
  async signedUrl(@Param('recordId') recordId: string, @Param('docId') docId: string) {
    const data = await this.kycService.getSignedUrl(recordId, docId);
    return { data };
  }
}
