import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AdminUsersService } from './admin-users.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentAdminId } from '../../common/decorators/current-admin.decorator';
import { SetUserStatusDto } from './dto/set-user-status.dto';
import { AddUserNoteDto } from './dto/add-user-note.dto';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get()
  @RequirePermission('admin.users.view')
  async search(@Query('query') query?: string) {
    return { data: await this.adminUsersService.search(query) };
  }

  @Get(':id')
  @RequirePermission('admin.users.view')
  async detail(@Param('id') id: string) {
    return { data: await this.adminUsersService.getDetail(id) };
  }

  @Post(':id/status')
  @RequirePermission('admin.users.manage')
  async setStatus(
    @Param('id') id: string,
    @Body() dto: SetUserStatusDto,
    @CurrentAdminId() adminId: string,
  ) {
    return { data: await this.adminUsersService.setStatus(id, adminId, dto.status, dto.reason) };
  }

  @Post(':id/notes')
  @RequirePermission('admin.users.manage')
  async addNote(
    @Param('id') id: string,
    @Body() dto: AddUserNoteDto,
    @CurrentAdminId() adminId: string,
  ) {
    return { data: await this.adminUsersService.addNote(id, adminId, dto.note) };
  }
}
