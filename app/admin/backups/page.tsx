import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth';
import { BACKUP_RETENTION_COUNT, listBackups } from '@/lib/db-backup';
import AdminTabs from '@/components/AdminTabs';
import BackupNowButton from '@/components/BackupNowButton';
import RestoreBackupButton from '@/components/RestoreBackupButton';

export const metadata: Metadata = { title: { absolute: 'Backups — Scout' } };
export const dynamic = 'force-dynamic';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function AdminBackupsPage() {
  await requireAdmin();
  const backups = await listBackups();

  return (
    <div className="space-y-6">
      <AdminTabs />
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Backups</h1>
          <p className="text-sm max-w-2xl" style={{ color: 'var(--text-faint)' }}>
            A snapshot is a consistent export of every table, taken as of a single instant and stored in the
            database. The daily scheduled job takes one automatically; the newest {BACKUP_RETENTION_COUNT} are kept, older
            ones are pruned. Snapshots protect against a bad change or an accidental delete. They live in the
            same database they protect, so <strong>download one</strong> to keep a copy that survives losing the
            database itself.
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
            <table className="w-full text-sm min-w-[640px]" style={{ borderCollapse: 'collapse' }}>
              <thead className="text-left">
                <tr>
                  <th className="font-normal pb-2" style={{ color: 'var(--text-faint)' }}>Snapshot</th>
                  <th className="font-normal pb-2" style={{ color: 'var(--text-faint)' }}>Taken</th>
                  <th className="font-normal pb-2 text-right" style={{ color: 'var(--text-faint)' }}>Rows</th>
                  <th className="font-normal pb-2 text-right" style={{ color: 'var(--text-faint)' }}>Size</th>
                  <th className="font-normal pb-2 text-right" style={{ color: 'var(--text-faint)' }}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.fileName} style={{ borderTop: '1px solid var(--border-soft)' }}>
                    <td className="num py-2 pr-3">
                      {b.fileName}
                      {b.kind === 'pre-restore' && (
                        <span className="badge ml-2 text-[11px]" title="Taken automatically right before a restore, so that restore can be undone">before a restore</span>
                      )}
                    </td>
                    <td className="py-2 pr-3" style={{ color: 'var(--text-muted)' }}>{new Date(b.createdAt).toLocaleString()}</td>
                    <td className="num py-2 pr-3 text-right" style={{ color: 'var(--text-faint)' }}>{b.rowCount.toLocaleString()}</td>
                    <td className="num py-2 pr-3 text-right" style={{ color: 'var(--text-faint)' }}>{formatBytes(b.sizeBytes)}</td>
                    <td className="py-2 text-right align-top">
                      <div className="flex flex-col items-end gap-1">
                        <a className="text-xs underline" style={{ color: 'var(--accent)' }} href={`/api/admin/backup/${encodeURIComponent(b.fileName)}`}>Download</a>
                        <RestoreBackupButton fileName={b.fileName} />
                      </div>
                    </td>
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
          <strong>Restore</strong> replaces everything in the database with the chosen snapshot — every account,
          balance, trade and artist goes back to how it was at that moment, and anything since is gone. A
          snapshot of the current state is taken automatically first (marked “before a restore”), so a restore
          can itself be undone. Signed-in users whose accounts did not exist in the snapshot are signed out.
        </p>
        <p className="m-0">
          If the database itself is lost, a downloaded snapshot can be loaded into a new one with
          {' '}<code>scripts/restore-db.js</code> — see <code>docs/DEPLOYMENT.md</code>.
        </p>
      </div>
    </div>
  );
}
