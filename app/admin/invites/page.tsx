import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth';
import AdminTabs from '@/components/AdminTabs';
import InvitesAdmin from '@/components/InvitesAdmin';
import { inviteSummary, listInvites } from '@/lib/invites';

export const metadata: Metadata = { title: { absolute: 'Beta invites — Scout' } };
export const dynamic = 'force-dynamic';

export default async function AdminInvitesPage() {
  await requireAdmin();
  const s = await inviteSummary();
  const invites = await listInvites();
  const appUrl = process.env.APP_URL ?? 'https://send-a-shot.onrender.com';

  return (
    <div className="space-y-6">
      <AdminTabs />
      <div>
        <h1 className="text-2xl font-bold">Beta invites</h1>
        <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
          One code per person. Each works once; the link fills it in on the signup page. See docs/BETA-PLAN.md.
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ['Joined', `${s.used} / ${s.cap}`],
          ['Unused', String(s.open)],
          ['Revoked', String(s.revoked)],
          ['Signup', s.inviteOnly ? 'Invite-only' : 'Open to anyone'],
        ].map(([k, v]) => (
          <div key={k} className="card">
            <p className="num text-xl font-semibold m-0">{v}</p>
            <p className="text-sm m-0" style={{ color: 'var(--text-faint)' }}>{k}</p>
          </div>
        ))}
      </div>
      {!s.inviteOnly && (
        <p className="text-sm m-0" style={{ color: 'var(--text-muted)' }}>
          Signup is currently open to anyone. To require an invite, set <span className="font-mono">SIGNUP_MODE=invite</span> in Render&apos;s Environment tab.
        </p>
      )}
      <InvitesAdmin invites={invites} appUrl={appUrl} />
    </div>
  );
}
