import { requireAdmin } from '@/lib/auth';
import { getAllUsers } from '@/lib/db';
import RoleManager from '@/components/RoleManager';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const admin = await requireAdmin();
  const users = getAllUsers();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Manage users</h1>
        <p className="text-neutral-400 text-sm">
          Grant Scout (internal) or Admin access. New signups always start as Public — this is the
          only way roles change.
        </p>
      </div>
      <RoleManager users={users} currentAdminId={admin.id} />
    </div>
  );
}
