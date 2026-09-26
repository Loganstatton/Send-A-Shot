import { Module } from '@nestjs/common';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminUsersService } from './admin-users.service';
import { AdminUsersController } from './admin-users.controller';
import { AdminRolesService } from './admin-roles.service';
import { AdminRolesController } from './admin-roles.controller';
import { AdminAuditLogService } from './admin-audit-log.service';
import { AdminAuditLogController } from './admin-audit-log.controller';
import { WalletModule } from '../wallet/wallet.module';

/**
 * RBAC core + audit-log + dashboard. Every other module's own admin
 * sub-controllers (wallet, casino, promotions, compliance, kyc, payments,
 * redemptions, risk) write their own audit_logs rows for their own
 * mutations — this module only owns the endpoints listed in
 * docs/05-api-design.md under Dashboard/Users(status,notes)/Roles/Audit log.
 *
 * Imports WalletModule to reuse WalletService.getWallets/getTransactions
 * for the admin user-detail view instead of re-deriving balance/ledger
 * logic here.
 */
@Module({
  imports: [WalletModule],
  controllers: [
    AdminDashboardController,
    AdminUsersController,
    AdminRolesController,
    AdminAuditLogController,
  ],
  providers: [AdminDashboardService, AdminUsersService, AdminRolesService, AdminAuditLogService],
})
export class AdminModule {}
