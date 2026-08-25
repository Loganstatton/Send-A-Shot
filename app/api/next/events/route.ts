import { NextResponse } from 'next/server';
import { logEvent } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { AnalyticsEventType } from '@/lib/types';

export const dynamic = 'force-dynamic';

// The client-initiated half of event tracking — everything logEvent()
// records server-side on its own (signup, trades, watchlist changes, page
// views) never touches this route. This is only for events that happen
// entirely in the browser: a video play, a search, a filter, or the
// moment a buy is reviewed but not yet submitted. Only NEXT-side events
// are accepted here — Scout's internal tool has its own actions, none of
// which are analytics-tracked yet.
const CLIENT_EVENT_TYPES: AnalyticsEventType[] = [
  'video_played', 'buy_started', 'search_used', 'filter_used',
  'feed_tab_changed', 'feed_artist_opened', 'feed_audio_played', 'feed_watch_added', 'feed_trade_initiated', 'feed_scroll_depth',
];

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (!CLIENT_EVENT_TYPES.includes(body.eventType)) {
    return NextResponse.json({ error: 'unsupported eventType' }, { status: 400 });
  }
  const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : undefined;

  logEvent(user.id, body.eventType, metadata);
  return NextResponse.json({ ok: true });
}
