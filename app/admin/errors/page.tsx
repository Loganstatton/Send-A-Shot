import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth';
import { getErrorReportCount, getRecentErrorReports } from '@/lib/db';
import AdminTabs from '@/components/AdminTabs';

export const metadata: Metadata = { title: { absolute: 'Errors — Scout' } };
export const dynamic = 'force-dynamic';

export default async function AdminErrorsPage() {
  await requireAdmin();
  const reports = getRecentErrorReports(100);
  const last24h = getErrorReportCount(24);

  return (
    <div className="space-y-6">
      <AdminTabs />
      <div>
        <h1 className="text-2xl font-bold">Errors</h1>
        <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
          Uncaught exceptions reported by app/error.tsx (a page render crashed) and lib/error-log.ts (a route
          handler hit something unexpected). Self-hosted — there's no external APM this app is wired up to.
        </p>
      </div>

      <div className="card">
        <p className="num text-xl font-semibold m-0">{last24h}</p>
        <p className="text-sm m-0" style={{ color: 'var(--text-faint)' }}>errors in the last 24 hours</p>
      </div>

      <div className="card space-y-3">
        <h2 className="font-bold text-lg">Recent ({reports.length})</h2>
        {reports.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No errors reported yet.</p>
        ) : (
          <div className="space-y-2">
            {reports.map((r) => (
              <details key={r.id} className="rounded-lg px-4 py-3" style={{ border: '1px solid var(--down)', background: 'oklch(64% 0.2 19 / 0.08)' }}>
                <summary className="cursor-pointer flex items-center justify-between gap-3 flex-wrap">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="badge text-xs shrink-0">{r.source}</span>
                    <span className="text-sm truncate">{r.message}</span>
                  </span>
                  <span className="text-xs shrink-0" style={{ color: 'var(--text-faint)' }}>{new Date(r.created_at).toLocaleString()}</span>
                </summary>
                <div className="mt-2 text-xs space-y-1" style={{ color: 'var(--text-muted)' }}>
                  {r.path && <p className="m-0">Path: <span className="num">{r.path}</span></p>}
                  {r.user_name && <p className="m-0">User: {r.user_name}</p>}
                  {r.digest && <p className="m-0">Digest: <span className="num">{r.digest}</span></p>}
                  {r.stack && <pre className="mt-1.5 whitespace-pre-wrap overflow-x-auto" style={{ color: 'var(--text-faint)' }}>{r.stack}</pre>}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
