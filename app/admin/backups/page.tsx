import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth';
import { BACKUP_RETENTION_COUNT, listBackups } from '@/lib/db-backup';
import AdminTabs from '@/components/AdminTabs';
import BackupNowButton from '@/components/BackupNowButton';

export const metadata: Metadata = { title: { absolute: 'Backups — Scout' } };
export const dynamic = 'force-dynamic';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function AdminBackupsPage() {
  await requireAdmin();
  const backups = listBackups();

  return (
    <div className="space-y-6">
      <AdminTabs />
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Backups</h1>
          <p className="text-sm max-w-2xl" style={{ color: 'var(--text-faint)' }}>
            A point-in-time snapshot of the whole database (<code>VACUUM INTO</code>, crash-consistent even in
            WAL mode), written to the same persistent disk the live database is on. The daily GitHub Actions
            workflow runs this automatically; the newest {BACKUP_RETENTION_COUNT} are kept, older ones are pruned. This protects
            against a bad migration or an accidental delete — not against losing the disk itself, since there's
            no off-site copy configured yet.
          </p>
        </div>
        <BackupNowButton />
      </div>

      <div className="card space-y-3">
        <h2 className="font-bold text-lg">History ({backups.length})</h2>
        {backups.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No backups yet — click "Back up now" or wait for the daily job.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[420px]" style={{ borderCollapse: 'collapse' }}>
              <thead className="text-left">
                <tr>
                  <th className="font-normal pb-2" style={{ color: 'var(--text-faint)' }}>File</th>
                  <th className="font-normal pb-2" style={{ color: 'var(--text-faint)' }}>Created</th>
                  <th className="font-normal pb-2 text-right" style={{ color: 'var(--text-faint)' }}>Size</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.fileName} style={{ borderTop: '1px solid var(--border-soft)' }}>
                    <td className="num py-2 pr-3">{b.fileName}</td>
                    <td className="py-2 pr-3" style={{ color: 'var(--text-muted)' }}>{new Date(b.createdAt).toLocaleString()}</td>
                    <td className="num py-2 text-right" style={{ color: 'var(--text-faint)' }}>{formatBytes(b.sizeBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card space-y-2 text-sm" style={{ color: 'var(--text-muted)' }}>
        <h2 className="font-bold text-lg" style={{ color: 'var(--text)' }}>Restoring</h2>
        <p className="m-0">
          Restoring overwrites the live database, so it isn't exposed as a one-click web action — it needs
          direct access to the server's disk. See the "Database backups and restore" section of the README for
          the exact steps (<code>scripts/restore-db.js</code>).
        </p>
      </div>
    </div>
  );
}
