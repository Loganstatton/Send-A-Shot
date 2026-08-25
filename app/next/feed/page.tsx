import type { Metadata } from 'next';
import { getFeedEvents, getWatchlistArtistIds, logEvent, logFeedItemImpressions } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { buildFeedAssemblyContext, buildFeedItems } from '@/lib/feed-items';
import FeedView from '@/components/next/FeedView';

export const metadata: Metadata = { title: 'Feed' };
export const dynamic = 'force-dynamic';

// How many feed_events the initial load pulls — small enough to render
// fast, large enough that the For You tab (which includes every event, just
// ranked) rarely feels sparse. components/next/FeedView.tsx pages in more
// via /api/next/feed as the user scrolls.
const INITIAL_BATCH_SIZE = 40;

export default async function FeedPage() {
  const user = await requireUser();

  const events = getFeedEvents(INITIAL_BATCH_SIZE);
  const ctx = buildFeedAssemblyContext(user.id, events);
  const items = buildFeedItems(events, ctx);

  logEvent(user.id, 'feed_opened');
  logFeedItemImpressions(user.id, items.map((i) => i.id));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display font-bold text-[34px] m-0 tracking-[-0.01em]">Feed</h1>
        <p className="mt-1 mb-0 text-sm" style={{ color: 'var(--text-faint)' }}>
          Real activity from the artists you follow and the wider NEXT market — no fake trades, no fake engagement.
        </p>
      </div>
      <FeedView
        initialItems={items}
        initialNextBeforeId={events.length > 0 ? events[events.length - 1].id : null}
        initialHasMore={events.length === INITIAL_BATCH_SIZE}
        watchedArtistIds={getWatchlistArtistIds(user.id)}
        viewerUserId={user.id}
      />
    </div>
  );
}
