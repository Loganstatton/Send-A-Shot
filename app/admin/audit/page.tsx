import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth';
import { getAuditLog } from '@/lib/audit';
import AdminTabs from '@/components/AdminTabs';

export const metadata: Metadata = { title: { absolute: 'Audit log — Scout' } };
export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  await requireAdmin();
  const entries = await getAuditLog();
  return (
    <div className="space-y-6">
      <AdminTabs />
      <div>
        <h1 className="text-2xl font-bold">Audit log</h1>
        <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
          Role changes, backups and restores, artist claim and request decisions, and collection publishing — newest first.
        </p>
      </div>
      <div className="card overflow-x-auto">
        {entries.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Nothing recorded yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ color: 'var(--text-faint)' }}>
                <th scope="col" className="py-1 pr-3 font-normal">When</th>
                <th scope="col" className="py-1 pr-3 font-normal">Who</th>
                <th scope="col" className="py-1 pr-3 font-normal">Action</th>
                <th scope="col" className="py-1 font-normal">Target</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} style={{ borderTop: '1px solid var(--border-soft)' }}>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</td>
                  <td className="py-1.5 pr-3">{e.actor_name ?? 'system'}</td>
                  <td className="py-1.5 pr-3">{e.action.replace(/_/g, ' ')}</td>
                  <td className="py-1.5">{e.target_type ? `${e.target_type} ${e.target_id}` : ''}{e.detail ? ` · ${e.detail}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
