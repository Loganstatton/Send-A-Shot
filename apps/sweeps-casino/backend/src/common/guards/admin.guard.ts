import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { PERMISSION_KEY } from '../decorators/permissions.decorator';

/**
 * Runs after JwtAuthGuard. Requires the authenticated user to have an
 * active AdminUser row, and — when the route declares @RequirePermission —
 * that the admin's role.permissions includes it. Every admin route this
 * guards is expected to also write an audit_logs row in its handler; the
 * guard only gates access, it doesn't log (the handler knows the
 * before/after state the log needs).
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as { userId: string } | undefined;

    if (!user) {
      throw new ForbiddenException({
        code: 'ADMIN_REQUIRED',
        message: 'Authentication required.',
      });
    }

    const admin = await this.prisma.adminUser.findUnique({
      where: { userId: user.userId },
      include: { role: true },
    });

    if (!admin || !admin.active) {
      throw new ForbiddenException({
        code: 'ADMIN_REQUIRED',
        message: 'This account does not have admin access.',
      });
    }

    const requiredPermission = this.reflector.get<string | undefined>(
      PERMISSION_KEY,
      context.getHandler(),
    );

    if (requiredPermission) {
      const permissions = (admin.role.permissions as string[] | { all?: boolean }) ?? [];
      const hasAll =
        !Array.isArray(permissions) && (permissions as { all?: boolean }).all === true;
      const hasPermission =
        hasAll || (Array.isArray(permissions) && permissions.includes(requiredPermission));

      if (!hasPermission) {
        throw new ForbiddenException({
          code: 'PERMISSION_DENIED',
          message: `Missing required permission: ${requiredPermission}`,
        });
      }
    }

    request.adminUser = admin;
    return true;
  }
}
