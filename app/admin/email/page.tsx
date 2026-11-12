import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth';
import { getEmailStats } from '@/lib/email';
import AdminTabs from '@/components/AdminTabs';
import SendTestEmailButton from '@/components/SendTestEmailButton';
import { LocalDateTime } from '@/components/LocalTime';

export const metadata: Metadata = { title: { absolute: 'Email — Scout' } };
export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  sent: 'Sent',
  failed: 'Failed after retries',
  deferred: 'Held back (daily cap)',
  not_configured: 'Not sent (email not set up)',
};

export default async function AdminEmailPage() {
  const admin = await requireAdmin();
  const s = await getEmailStats();
  const totals = new Map<string, number>();
  for (const r of s.last7d) totals.set(r.status, (totals.get(r.status) ?? 0) + r.n);

  return (
    <div className="space-y-6">
      <AdminTabs />
      <div>
        <h1 className="text-2xl font-bold">Email</h1>
        <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
          Verification and password-reset emails are how players get back into their accounts. Every send is retried
          up to three times and recorded here.
        </p>
      </div>

      <div className="card space-y-2">
        <h2 className="font-bold text-lg m-0">Setup</h2>
        {s.configured ? (
          <p className="text-sm m-0">
            <span className="badge text-xs mr-2" style={{ color: 'var(--up)' }}>On</span>
            Sending through Resend as <span className="font-mono">{s.from}</span>.
          </p>
        ) : (
          <p className="text-sm m-0" style={{ color: 'var(--down)' }}>
            Off — no email is being delivered. Set <span className="font-mono">RESEND_API_KEY</span> and{' '}
            <span className="font-mono">EMAIL_FROM</span> in Render&apos;s Environment tab (see docs/EMAIL-SETUP.md).
          </p>
        )}
        <p className="text-sm m-0" style={{ color: 'var(--text-muted)' }}>
          {s.sentLast24h} of {s.dailyLimit} sent in the last 24 hours. Notification digests pause at{' '}
          {s.dailyLimit - s.reserve}, keeping {s.reserve} for verification and reset emails.
        </p>
        <SendTestEmailButton to={admin.email} disabled={!s.configured} />
      </div>

      <div className="card space-y-2">
        <h2 className="font-bold text-lg m-0">Last 7 days</h2>
        {s.last7d.length === 0 ? (
          <p className="text-sm m-0" style={{ color: 'var(--text-muted)' }}>No emails yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: 'var(--text-faint)' }}>
                  <th className="text-left py-1.5 pr-3 font-normal">Outcome</th>
                  <th className="text-left py-1.5 pr-3 font-normal">Kind</th>
                  <th className="text-right py-1.5 font-normal">Count</th>
                </tr>
              </thead>
              <tbody>
                {s.last7d.map((r) => (
                  <tr key={`${r.status}-${r.kind}`} style={{ borderTop: '1px solid var(--border-soft)' }}>
                    <td className="py-1.5 pr-3">{STATUS_LABEL[r.status] ?? r.status}</td>
                    <td className="py-1.5 pr-3">{r.kind}</td>
                    <td className="py-1.5 text-right num">{r.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card space-y-2">
        <h2 className="font-bold text-lg m-0">Problems ({s.recentProblems.length})</h2>
        {s.recentProblems.length === 0 ? (
          <p className="text-sm m-0" style={{ color: 'var(--text-muted)' }}>Nothing failed or held back.</p>
        ) : (
          <ul className="list-none p-0 m-0 space-y-2">
            {s.recentProblems.map((p, i) => (
              <li key={i} className="text-sm rounded-lg px-3 py-2" style={{ border: '1px solid var(--border-soft)' }}>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  <span className="font-semibold">{STATUS_LABEL[p.status] ?? p.status}</span>
                  <span>{p.kind}</span>
                  <span className="break-all">{p.toEmail}</span>
                  <span style={{ color: 'var(--text-faint)' }}><LocalDateTime iso={p.createdAt} /></span>
                </div>
                {p.error && <div className="text-xs mt-1 break-words" style={{ color: 'var(--text-faint)' }}>{p.error}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
