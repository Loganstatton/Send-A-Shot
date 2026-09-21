import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Set by AdminGuard onto the request after verifying the caller is an active admin. */
export const CurrentAdminId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest();
  return req.adminUser.id;
});
