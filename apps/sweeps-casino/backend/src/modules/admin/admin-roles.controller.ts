import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AdminRolesService } from './admin-roles.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentAdminId } from '../../common/decorators/current-admin.decorator';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
import { GrantAdminAccessDto, UpdateAdminUserDto } from './dto/admin-user.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminRolesController {
  constructor(private readonly adminRolesService: AdminRolesService) {}

  @Get('roles')
  @RequirePermission('admin.roles.manage')
  async listRoles() {
    return { data: await this.adminRolesService.listRoles() };
  }

  @Post('roles')
  @RequirePermission('admin.roles.manage')
  async createRole(@Body() dto: CreateRoleDto, @CurrentAdminId() adminId: string) {
    return { data: await this.adminRolesService.createRole(adminId, dto.key, dto.permissions) };
  }

  @Patch('roles/:id')
  @RequirePermission('admin.roles.manage')
  async updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentAdminId() adminId: string,
  ) {
    return { data: await this.adminRolesService.updateRole(adminId, id, dto.permissions) };
  }

  @Get('admin-users')
  @RequirePermission('admin.roles.manage')
  async listAdminUsers() {
    return { data: await this.adminRolesService.listAdminUsers() };
  }

  @Post('admin-users')
  @RequirePermission('admin.roles.manage')
  async grantAdminAccess(@Body() dto: GrantAdminAccessDto, @CurrentAdminId() adminId: string) {
    return { data: await this.adminRolesService.grantAdminAccess(adminId, dto.userId, dto.roleId) };
  }

  @Patch('admin-users/:id')
  @RequirePermission('admin.roles.manage')
  async updateAdminUser(
    @Param('id') id: string,
    @Body() dto: UpdateAdminUserDto,
    @CurrentAdminId() adminId: string,
  ) {
    return { data: await this.adminRolesService.updateAdminUser(adminId, id, dto) };
  }
}
