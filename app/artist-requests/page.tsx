import type { Metadata } from 'next';
import { requireInternal } from '@/lib/auth';
import { getRequestQueue, REQUEST_KIND_LABELS } from '@/lib/artist-requests';
import ArtistRequestQueue from '@/components/ArtistRequestQueue';

export const metadata: Metadata = { title: { absolute: 'Artist requests — Scout' } };
export const dynamic = 'force-dynamic';

// Corrections, rating reviews, opt-outs, impersonation reports and claim
// disputes, oldest first. Shows the reporter's email (internal only) so
// staff can follow up outside NEXT where needed.
export default async function ArtistRequestsPage() {
  await requireInternal();
  const [open, closed] = await Promise.all([getRequestQueue('open'), getRequestQueue('closed')]);
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Artist requests</h1>
        <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
          Every request needs a note — the requester sees it. Resolving an opt-out removes the artist from NEXT. A rating
          review means a Scout looks again; it is never a negotiation.
        </p>
      </div>
      <section className="space-y-3">
        <h2 className="font-bold text-lg">Waiting ({open.length})</h2>
        <ArtistRequestQueue
          rows={open.map((r) => ({
            id: r.id, artistId: r.artist_id, artistName: r.artist_name, kind: r.kind, kindLabel: REQUEST_KIND_LABELS[r.kind], message: r.message,
            fromOwner: r.from_owner, reporterName: r.reporter_name, reporterEmail: r.reporter_email, createdAt: r.created_at,
          }))}
        />
      </section>
      {closed.length > 0 && (
        <section className="card space-y-2">
          <h2 className="font-bold text-lg">Recently handled</h2>
          <ul className="space-y-1.5 text-sm">
            {closed.slice(0, 30).map((r) => (
              <li key={r.id}>
                <span className="font-semibold">{REQUEST_KIND_LABELS[r.kind]}</span> — {r.artist_name} ·{' '}
                <span style={{ color: r.status === 'resolved' ? 'var(--up)' : 'var(--down)' }}>{r.status}</span>
                {r.resolution_note && <span style={{ color: 'var(--text-muted)' }}> · {r.resolution_note}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
