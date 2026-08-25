import { NextResponse } from 'next/server';
import { getFeedEvents } from '@/lib/db';
import { buildFeedAssemblyContext, buildFeedItems } from '@/lib/feed-items';
import { getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 60;

// Pagination for NEXT Feed's "load more" — the initial batch renders
// server-side in app/next/feed/page.tsx; this route fetches older pages as
// the user scrolls. Returns plain chronological DTOs (not tab-ranked —
// ranking happens client-side over the accumulated pool, see
// lib/feed-ranking.ts and components/next/FeedView.tsx) so every tab can
// reuse the same paged-in data instead of each needing its own endpoint.
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const beforeIdParam = url.searchParams.get('beforeId');
  const beforeId = beforeIdParam != null && Number.isInteger(Number(beforeIdParam)) ? Number(beforeIdParam) : undefined;
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT));

  const events = getFeedEvents(limit, beforeId);
  const ctx = buildFeedAssemblyContext(user.id, events);
  const items = buildFeedItems(events, ctx);

  return NextResponse.json({
    items,
    nextBeforeId: events.length > 0 ? events[events.length - 1].id : null,
    hasMore: events.length === limit,
  });
}
