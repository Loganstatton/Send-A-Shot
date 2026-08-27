'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { FeedItemDTO } from '@/lib/feed-items';
import { FEED_TABS, FeedTab, rankFeedItems } from '@/lib/feed-ranking';
import { track } from '@/lib/track';
import FeedCard from '@/components/next/FeedCard';
import FeedComposer from '@/components/next/FeedComposer';

// Every tab reads from the same pool of loaded items — "load more" pages in
// more raw feed_events (chronological, unfiltered) via /api/next/feed, and
// switching tabs just re-filters/re-ranks that same pool client-side
// (lib/feed-ranking.ts has no server-only imports, so this is instant, no
// refetch) rather than hitting a separate endpoint per tab.
export default function FeedView({
  initialItems,
  initialNextBeforeId,
  initialHasMore,
  watchedArtistIds,
  viewerUserId,
}: {
  initialItems: FeedItemDTO[];
  initialNextBeforeId: number | null;
  initialHasMore: boolean;
  watchedArtistIds: number[];
  viewerUserId: number;
}) {
  const [items, setItems] = useState(initialItems);
  const [tab, setTab] = useState<FeedTab>('for_you');
  const [nextBeforeId, setNextBeforeId] = useState(initialNextBeforeId);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [composerOpenSignal, setComposerOpenSignal] = useState(0);
  const watchedSet = useMemo(() => new Set(watchedArtistIds), [watchedArtistIds]);

  const ranked = useMemo(() => rankFeedItems(items, tab), [items, tab]);

  function changeTab(next: FeedTab) {
    if (next === tab) return;
    setTab(next);
    track('feed_tab_changed', { tab: next });
  }

  function removePost(feedEventId: number) {
    setItems((prev) => prev.filter((i) => i.id !== feedEventId));
  }

  // Re-fetches the newest page and merges it into the head of the loaded
  // pool (by id) — used right after posting a User Take, so it shows up
  // immediately without a full page reload or losing scroll position/older
  // already-loaded items.
  async function refreshFromTop() {
    try {
      const res = await fetch('/api/next/feed');
      if (!res.ok) return;
      const data = await res.json();
      const freshIds = new Set(data.items.map((i: FeedItemDTO) => i.id));
      setItems((prev: FeedItemDTO[]) => [...data.items, ...prev.filter((i) => !freshIds.has(i.id))]);
    } catch {
      // Best-effort — the post still succeeded server-side; it'll show up on next natural refresh/load-more.
    }
  }

  async function loadMore() {
    if (loadingMore || !hasMore || nextBeforeId == null) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/next/feed?beforeId=${nextBeforeId}`);
      if (!res.ok) throw new Error('request failed');
      const data = await res.json();
      setItems((prev) => [...prev, ...data.items]);
      setNextBeforeId(data.nextBeforeId);
      setHasMore(data.hasMore);
    } catch {
      // Best-effort — the sentinel is still there, so scrolling again retries.
    } finally {
      setLoadingMore(false);
    }
  }

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: '400px' } // start fetching before the sentinel is actually on screen — smooth scroll, no visible pause
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextBeforeId, hasMore, loadingMore]);

  // Scroll depth, once per threshold for this page visit (not reset by tab
  // switches, which don't re-scroll the page).
  const loggedDepths = useRef(new Set<number>());
  useEffect(() => {
    function onScroll() {
      const doc = document.documentElement;
      const scrolledPct = doc.scrollHeight <= doc.clientHeight ? 100 : ((window.scrollY + doc.clientHeight) / doc.scrollHeight) * 100;
      for (const threshold of [25, 50, 75, 100]) {
        if (scrolledPct >= threshold && !loggedDepths.current.has(threshold)) {
          loggedDepths.current.add(threshold);
          track('feed_scroll_depth', { depthPct: threshold });
        }
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <FeedComposer onPosted={refreshFromTop} openSignal={composerOpenSignal} />

      <div className="flex items-center gap-2">
        {FEED_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => changeTab(t.key)}
            className={`next-pill ${tab === t.key ? 'next-pill-active' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <FeedGettingStartedState onShareTake={() => setComposerOpenSignal((n) => n + 1)} />
      ) : ranked.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <div className="flex flex-col gap-3">
          {ranked.map((item) => (
            <FeedCard
              key={item.id}
              item={item}
              watching={item.artist ? watchedSet.has(item.artist.id) : false}
              viewerUserId={viewerUserId}
              onPostDeleted={removePost}
            />
          ))}
        </div>
      )}

      {hasMore && <div ref={sentinelRef} className="h-4" aria-hidden="true" />}
      {loadingMore && <p className="text-center text-xs m-0" style={{ color: 'var(--text-faint)' }}>Loading more…</p>}
    </div>
  );
}

// The genuinely-nothing-yet state (no items loaded at all, any tab) — per
// the spec, distinct from the per-tab "nothing matches this filter" states
// below. Real system-generated activity plus the one-time historical
// bootstrap should normally mean this never renders on a live app; it's
// the honest fallback for the very first moment, not a broken blank page.
function FeedGettingStartedState({ onShareTake }: { onShareTake: () => void }) {
  return (
    <div className="next-card text-center py-16 flex flex-col items-center gap-4">
      <div>
        <p className="m-0 font-semibold">Your Feed is just getting started.</p>
        <p className="mt-1.5 mb-0 text-sm" style={{ color: 'var(--text-faint)' }}>
          Discover artists, back musicians, or share your first take.
        </p>
      </div>
      <div className="flex items-center gap-2.5 flex-wrap justify-center">
        <Link href="/next" className="next-btn-primary text-sm px-5 py-2.5 rounded-[10px] font-bold">
          Discover Artists
        </Link>
        <button type="button" onClick={onShareTake} className="next-btn-ghost text-sm px-5 py-2.5 rounded-[10px] font-bold">
          Share a Take
        </button>
      </div>
    </div>
  );
}

function EmptyState({ tab }: { tab: FeedTab }) {
  if (tab === 'following') {
    return (
      <div className="next-card text-center py-16" style={{ color: 'var(--text-muted)' }}>
        <p className="m-0">You&apos;re not following anyone yet.</p>
        <p className="mt-1.5 mb-0 text-sm" style={{ color: 'var(--text-faint)' }}>
          Watch or back an artist and their activity will show up here.
        </p>
      </div>
    );
  }
  if (tab === 'market') {
    return (
      <div className="next-card text-center py-16" style={{ color: 'var(--text-muted)' }}>
        <p className="m-0">No market signals yet.</p>
        <p className="mt-1.5 mb-0 text-sm" style={{ color: 'var(--text-faint)' }}>
          Signals post automatically once there&apos;s a real score or price move to report.
        </p>
      </div>
    );
  }
  return (
    <div className="next-card text-center py-16" style={{ color: 'var(--text-muted)' }}>
      <p className="m-0">Nothing here yet.</p>
      <p className="mt-1.5 mb-0 text-sm" style={{ color: 'var(--text-faint)' }}>
        Check back after the next artist joins or the market moves.
      </p>
    </div>
  );
}
