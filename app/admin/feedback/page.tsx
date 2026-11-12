import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth';
import { getFeedback, getFeedbackSummary } from '@/lib/feedback';
import AdminTabs from '@/components/AdminTabs';

export const metadata: Metadata = { title: { absolute: 'Beta feedback — Scout' } };
export const dynamic = 'force-dynamic';

export default async function FeedbackAdminPage() {
  await requireAdmin();
  const [entries, summary] = await Promise.all([getFeedback(), getFeedbackSummary()]);
  return (
    <div className="space-y-6">
      <AdminTabs />
      <div>
        <h1 className="text-2xl font-bold">Beta feedback</h1>
        <p className="text-sm" style={{ color: 'var(--text-faint)' }}>From /next/feedback. Newest first.</p>
      </div>
      <div className="card">
        <p className="text-sm">
          {summary.total} {summary.total === 1 ? 'response' : 'responses'} · understood the scoring: <strong>{summary.yes}</strong> yes,{' '}
          <strong>{summary.partly}</strong> partly, <strong>{summary.no}</strong> no
        </p>
      </div>
      <ul className="space-y-3">
        {entries.map((f) => (
          <li key={f.id} className="card space-y-1.5 text-sm">
            <div className="flex justify-between gap-2 flex-wrap text-xs" style={{ color: 'var(--text-faint)' }}>
              <span>{f.user_name ?? 'deleted account'}{f.user_email ? ` <${f.user_email}>` : ''}{f.page ? ` · from ${f.page}` : ''}</span>
              <span>{new Date(f.created_at).toLocaleString()}</span>
            </div>
            {f.understood_scoring && <p>Understood scoring: <strong>{f.understood_scoring}</strong></p>}
            {f.enjoyed && <p><span style={{ color: 'var(--up)' }}>Enjoyed:</span> {f.enjoyed}</p>}
            {f.confused && <p><span style={{ color: 'var(--fire)' }}>Confused / wants:</span> {f.confused}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
