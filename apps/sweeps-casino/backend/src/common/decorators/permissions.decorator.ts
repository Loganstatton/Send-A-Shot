import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'requiredPermission';

/**
 * Marks an admin endpoint as requiring a specific fine-grained permission
 * string (e.g. "users.adjust_balance", "compliance.jurisdictions.write").
 * Checked by AdminGuard against the caller's admin_roles.permissions.
 * Permission strings are data (see admin_roles seed), not enum-hardcoded,
 * so new capabilities don't require a guard code change.
 */
export const RequirePermission = (permission: string) =>
  SetMetadata(PERMISSION_KEY, permission);
