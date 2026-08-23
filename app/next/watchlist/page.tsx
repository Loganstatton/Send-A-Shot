import type { Metadata } from 'next';
import { getScoreChanges, getUserWatchlist } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import DiscoverGrid from '@/components/next/DiscoverGrid';

export const metadata: Metadata = { title: 'Watchlist' };
export const dynamic = 'force-dynamic';

export default async function WatchlistPage() {
  const user = await requireUser();
  const entries = getUserWatchlist(user.id);
  const watchedIds = entries.map((r) => r.artist.id);
  const scoreChanges = getScoreChanges();
  const sinceWatchedByArtist = Object.fromEntries(
    entries.map((e) => [
      e.artist.id,
      { watchedAt: e.watchedAt, alertsEnabled: e.alertsEnabled, scoreAtWatch: e.scoreAtWatch, priceAtWatchCents: e.priceAtWatchCents },
    ])
  );

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display font-bold text-[34px] m-0 tracking-[-0.01em]">Watchlist</h1>
        <p className="mt-1 mb-0 text-sm" style={{ color: 'var(--text-faint)' }}>
          Artists you&apos;re tracking — no credits spent, nothing at stake yet.
        </p>
      </div>

      {entries.length === 0 ? (
        <div className="next-card text-center py-16" style={{ color: 'var(--text-muted)' }}>
          <p className="m-0">You&apos;re not watching anyone yet.</p>
          <p className="mt-1.5 mb-0 text-sm" style={{ color: 'var(--text-faint)' }}>
            Tap the bookmark on any artist card to start tracking them here.
          </p>
        </div>
      ) : (
        <DiscoverGrid
          rows={entries}
          watchedIds={watchedIds}
          scoreChanges={scoreChanges}
          sinceWatchedByArtist={sinceWatchedByArtist}
          emptyMessage="No watched artists match these filters."
        />
      )}
    </div>
  );
}
