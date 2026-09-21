import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AdminRoleKey, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

function isUniqueConstraintError(e: unknown): e is Prisma.PrismaClientKnownRequestError {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

@Injectable()
export class AdminRolesService {
  constructor(private readonly prisma: PrismaService) {}

  listRoles() {
    return this.prisma.adminRole.findMany();
  }

  async createRole(adminId: string, key: AdminRoleKey, permissions: string[]) {
    let role;
    try {
      role = await this.prisma.adminRole.create({ data: { key, permissions } });
    } catch (e) {
      if (isUniqueConstraintError(e)) {
        throw new ConflictException({
          code: 'ROLE_KEY_EXISTS',
          message: `A role with key ${key} already exists.`,
        });
      }
      throw e;
    }

    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: 'admin_role.create',
        targetType: 'admin_role',
        targetId: role.id,
        newState: { key, permissions },
      },
    });

    return role;
  }

  async updateRole(adminId: string, roleId: string, permissions: string[]) {
    const existing = await this.prisma.adminRole.findUnique({ where: { id: roleId } });
    if (!existing) {
      throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: 'Role not found.' });
    }

    const updated = await this.prisma.adminRole.update({ where: { id: roleId }, data: { permissions } });

    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: 'admin_role.update',
        targetType: 'admin_role',
        targetId: roleId,
        oldState: { permissions: existing.permissions as Prisma.InputJsonValue },
        newState: { permissions },
      },
    });

    return updated;
  }

  listAdminUsers() {
    return this.prisma.adminUser.findMany({
      include: { role: true, user: { select: { id: true, email: true, username: true } } },
    });
  }

  async grantAdminAccess(adminId: string, userId: string, roleId: string) {
    const [user, role] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.adminRole.findUnique({ where: { id: roleId } }),
    ]);
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' });
    if (!role) throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: 'Role not found.' });

    let created;
    try {
      created = await this.prisma.adminUser.create({ data: { userId, roleId } });
    } catch (e) {
      if (isUniqueConstraintError(e)) {
        throw new ConflictException({
          code: 'ADMIN_USER_EXISTS',
          message: 'This user already has admin access.',
        });
      }
      throw e;
    }

    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: 'admin_user.create',
        targetType: 'admin_user',
        targetId: created.id,
        newState: { userId, roleId },
      },
    });

    return created;
  }

  async updateAdminUser(
    adminId: string,
    targetAdminUserId: string,
    patch: { roleId?: string; active?: boolean },
  ) {
    const existing = await this.prisma.adminUser.findUnique({ where: { id: targetAdminUserId } });
    if (!existing) {
      throw new NotFoundException({ code: 'ADMIN_USER_NOT_FOUND', message: 'Admin user not found.' });
    }
    if (patch.roleId) {
      const role = await this.prisma.adminRole.findUnique({ where: { id: patch.roleId } });
      if (!role) throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: 'Role not found.' });
    }

    const updated = await this.prisma.adminUser.update({
      where: { id: targetAdminUserId },
      data: patch,
    });

    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: 'admin_user.update',
        targetType: 'admin_user',
        targetId: targetAdminUserId,
        oldState: { roleId: existing.roleId, active: existing.active },
        newState: patch,
      },
    });

    return updated;
  }
}
