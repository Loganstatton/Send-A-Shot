import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { SupportTicketStatus } from '@prisma/client';
import { SupportService } from './support.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentAdminId } from '../../common/decorators/current-admin.decorator';
import { AdminUpdateTicketDto } from './dto/admin-update-ticket.dto';
import { CreateMessageDto } from './dto/create-message.dto';

@Controller('admin/support/tickets')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminSupportController {
  constructor(private readonly supportService: SupportService) {}

  @Get()
  @RequirePermission('support.manage')
  async list(@Query('status') status?: SupportTicketStatus) {
    return { data: await this.supportService.listTicketsForAdmin({ status }) };
  }

  @Get(':id')
  @RequirePermission('support.manage')
  async get(@Param('id') id: string) {
    return { data: await this.supportService.getTicketForAdmin(id) };
  }

  @Patch(':id')
  @RequirePermission('support.manage')
  async update(@Param('id') id: string, @Body() dto: AdminUpdateTicketDto) {
    return { data: await this.supportService.updateTicketForAdmin(id, dto) };
  }

  @Post(':id/messages')
  @RequirePermission('support.manage')
  async addMessage(
    @CurrentAdminId() adminId: string,
    @Param('id') id: string,
    @Body() dto: CreateMessageDto,
  ) {
    return { data: await this.supportService.addAdminMessage(adminId, id, dto.body) };
  }
}
