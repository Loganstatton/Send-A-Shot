// NEXT Feed's ranking — deliberately transparent and hand-tunable, not an
// opaque model. It scores each already-assembled FeedItemDTO (see
// lib/feed-items.ts, which computes the plain 0..1 factor inputs used
// below from real data) against one of three weight profiles, then runs a
// diversity pass so one active artist can't fill the whole feed. This file
// has no server-only imports (no db access) so the exact same scoring
// runs both server-side (initial render) and client-side (instant tab
// switching over data already on the page — see components/next/FeedView.tsx).

// Type-only imports — erased at compile time, so this file (imported
// directly by the client-side FeedView component for instant tab
// switching) never pulls lib/db.ts's better-sqlite3 dependency, or any
// other server-only code, into the browser bundle.
import type { FeedEventType } from './types';
import type { FeedItemDTO } from './feed-items';

export type FeedTab = 'for_you' | 'following' | 'market';

export const FEED_TABS: { key: FeedTab; label: string }[] = [
  { key: 'for_you', label: 'For You' },
  { key: 'following', label: 'Following' },
  { key: 'market', label: 'Market' },
];

// Event types that make up the Market tab — the data-heavy, price/score
// signals rather than social/discovery activity. Adjust this set (not the
// event schema) if what counts as "market" should change.
const MARKET_EVENT_TYPES = new Set<FeedEventType>([
  'signal_score_up', 'signal_score_down', 'signal_undervalued', 'signal_overheated',
  'market_momentum_mover', 'market_momentum_backers', 'market_momentum_most_watched',
]);

// One weight object per tab, all in the same units so they're comparable
// at a glance. Nothing here is load-bearing beyond "bigger number matters
// more" — change these to retune the feed without touching any other file.
// engagement (reaction/reply counts) is deliberately absent: reactions
// don't exist yet (a later PR), so there's nothing real to weight on yet.
type Weights = { relevance: number; genreAffinity: number; freshness: number; signalStrength: number; unusualActivity: number; momentum: number };

export const FEED_RANKING_WEIGHTS: Record<FeedTab, Weights> = {
  // For You: personalized — artists you watch/back and genres you're
  // already into get pulled to the top, freshness still matters a good
  // deal so it doesn't calcify into the same handful of names forever.
  for_you: { relevance: 40, genreAffinity: 15, freshness: 20, signalStrength: 15, unusualActivity: 10, momentum: 0 },
  // Following: the item set is already filtered to watched/backed artists
  // (see itemMatchesTab below), so relevance/genre add nothing more here —
  // this tab reads as close to "what changed, newest first" as the shared
  // scoring function can express without a second code path.
  following: { relevance: 0, genreAffinity: 0, freshness: 70, signalStrength: 15, unusualActivity: 15, momentum: 0 },
  // Market: no personalization at all — surfaces the strongest/most
  // unusual/most currently-moving signals regardless of who's watching.
  market: { relevance: 0, genreAffinity: 0, freshness: 20, signalStrength: 25, unusualActivity: 30, momentum: 25 },
};

// Half-life decay rather than a hard cutoff — a post from yesterday still
// shows up, just ranked below one from an hour ago. 36h means "most of a
// day and a half old" is the point an item has lost half its freshness
// score, tunable independent of everything else above.
const FRESHNESS_HALF_LIFE_HOURS = 36;

function freshnessScore(createdAt: string, now: number): number {
  const ageHours = Math.max(0, (now - new Date(createdAt).getTime()) / 3_600_000);
  return Math.pow(0.5, ageHours / FRESHNESS_HALF_LIFE_HOURS);
}

export function itemMatchesTab(item: FeedItemDTO, tab: FeedTab): boolean {
  if (tab === 'following') return item.factors.isFollowed;
  if (tab === 'market') return MARKET_EVENT_TYPES.has(item.eventType);
  return true;
}

export function scoreForTab(item: FeedItemDTO, tab: FeedTab, now: number = Date.now()): number {
  const w = FEED_RANKING_WEIGHTS[tab];
  const relevance = item.factors.isFollowed ? 1 : 0;
  const genre = item.factors.genreMatch ? 1 : 0;
  return (
    w.relevance * relevance +
    w.genreAffinity * genre +
    w.freshness * freshnessScore(item.createdAt, now) +
    w.signalStrength * item.factors.baseStrength +
    w.unusualActivity * item.factors.unusualness +
    w.momentum * item.factors.momentum
  );
}

// How many of the most-recently-placed items an artist must clear before
// it can appear again — the spec's "prevent one artist dominating
// consecutive feed items." A simple greedy pass: at each step, take the
// highest-scored remaining item whose artist isn't in the trailing window;
// if everything left conflicts (a very sparse feed), fall back to taking
// the top item anyway rather than getting stuck.
const DIVERSITY_WINDOW = 3;

function diversify(sortedByScore: FeedItemDTO[]): FeedItemDTO[] {
  const pending = [...sortedByScore];
  const result: FeedItemDTO[] = [];
  while (pending.length > 0) {
    const recentArtistIds = result.slice(-DIVERSITY_WINDOW).map((i) => i.artist?.id);
    let index = pending.findIndex((item) => item.artist == null || !recentArtistIds.includes(item.artist.id));
    if (index === -1) index = 0;
    result.push(pending[index]);
    pending.splice(index, 1);
  }
  return result;
}

// Filters to the items that belong on `tab`, scores and sorts them, then
// runs the diversity pass. Pure/synchronous — safe to call on every tab
// switch with data already loaded on the page, no refetch needed.
export function rankFeedItems(items: FeedItemDTO[], tab: FeedTab, now: number = Date.now()): FeedItemDTO[] {
  const matched = items.filter((item) => itemMatchesTab(item, tab));
  const scored = matched
    .map((item) => ({ item, score: scoreForTab(item, tab, now) }))
    .sort((a, b) => b.score - a.score)
    .map((s) => s.item);
  return diversify(scored);
}
