import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth';
import { getReportedUserTakePosts } from '@/lib/db';
import AdminTabs from '@/components/AdminTabs';
import FeedReportsList from '@/components/FeedReportsList';

export const metadata: Metadata = { title: { absolute: 'Feed reports — Scout' } };
export const dynamic = 'force-dynamic';

// Deliberately minimal — per the spec, not a full moderation suite. Every
// User Take with at least one report, newest report first, with exactly
// what a moderator needs to act: the real account behind it, the artist
// context, and a Hide button. Nothing here is public-safe data — this is
// an internal-only view (requireAdmin), so showing the real email is
// appropriate and expected, unlike anything shown on a public NEXT page.
export default async function FeedReportsPage() {
  await requireAdmin();
  const reported = getReportedUserTakePosts();

  return (
    <div className="space-y-6">
      <AdminTabs />
      <div>
        <h1 className="text-2xl font-bold">Feed reports</h1>
        <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
          User Take posts flagged by at least one NEXT user via Report. Hidden posts stop rendering in the Feed for
          everyone immediately; the row itself is never deleted, so a report always still points at something real.
        </p>
      </div>

      <div className="card space-y-3">
        <h2 className="font-bold text-lg">Reported ({reported.length})</h2>
        {reported.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No reported posts right now.</p>
        ) : (
          <FeedReportsList
            initial={reported.map((r) => ({
              postId: r.post.id,
              body: r.post.body,
              authorName: r.authorName,
              authorEmail: r.authorEmail,
              authorId: r.post.user_id,
              artistName: r.artistName,
              reportCount: r.reportCount,
              lastReportedAt: r.lastReportedAt,
              hidden: Boolean(r.post.hidden_at),
              createdAt: r.post.created_at,
            }))}
          />
        )}
      </div>
    </div>
  );
}
