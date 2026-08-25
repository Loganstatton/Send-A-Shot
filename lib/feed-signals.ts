// The automated (non-user-triggered) half of NEXT Feed's event generation
// — new_artist/early_discovery/artist_update/founding_believer_share all
// fire directly from the action that causes them (see lib/db.ts and the
// routes that call createFeedEvent). Signals and Market Momentum have no
// single triggering action — "artist crossed into undervalued territory"
// or "47 people backed this today" are only discoverable by periodically
// checking the whole roster, so this file exists to be called from a
// scheduled route the same way the Soundcharts/Deezer/YouTube syncs
// already are (see app/api/next/feed/generate-signals/route.ts and
// .github/workflows/discovery-scan.yml).
//
// Every threshold here reuses an existing, already-shipped definition of
// "significant" rather than inventing a new one for the Feed specifically
// — ALERT_SCORE_THRESHOLD/ALERT_PRICE_PCT_THRESHOLD are the exact numbers
// Watchlist alerts already use, and marketSentiment is the exact
// Undervalued/Overheated logic Discover and Watchlist already show.

import {
  createFeedEvent, getNextMarket, getRecentBackerCountsByArtist, getRecentWatchCountsByArtist, getScoreChanges,
  hasFeedEventSince,
} from './db';
import { ALERT_PRICE_PCT_THRESHOLD, ALERT_SCORE_THRESHOLD, changePctForWindow, marketSentiment } from './next-market';
import { FeedEventType } from './types';

// How long a still-true state (undervalued, overheated) or a recently-hit
// threshold goes without being re-posted — the exact scenario the spec
// calls out: "if an artist remains undervalued for 10 days, don't create
// the same undervalued post every day."
export const SIGNAL_COOLDOWN_DAYS = 10;

// "Meaningful" for the two count-based Market Momentum events — arbitrary
// but explicit and easy to tune, same spirit as ALERT_SCORE_THRESHOLD.
// Deliberately NOT "any trade" (the spec explicitly warns against
// flooding the feed with one-line trade events).
const MIN_BACKERS_FOR_MOMENTUM = 3;
const MIN_WATCHERS_FOR_MOMENTUM = 5;
const MOMENTUM_WINDOW_HOURS = 24;

export type FeedSignalResult = { checked: number; created: number };

function cooldownCutoff(): string {
  return new Date(Date.now() - SIGNAL_COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function maybePost(eventType: FeedEventType, artistId: number, cutoff: string, metadata: Record<string, unknown>): number {
  if (hasFeedEventSince(eventType, artistId, cutoff)) return 0;
  return createFeedEvent({ eventType, artistId, metadata }) ? 1 : 0;
}

// Called by the scheduled route. Walks the live roster once, checking each
// artist against every signal/momentum rule — cheap at NEXT's current
// scale (the same "load everything, filter in memory" approach
// getNextMarket's other callers already use), not something that needs
// its own SQL aggregation yet.
export function generateFeedSignals(): FeedSignalResult {
  const cutoff = cooldownCutoff();
  const market = getNextMarket().filter((row) => row.artist.stage !== 'passed');
  const scoreChanges = getScoreChanges();
  let created = 0;

  for (const { artist, score, priceCents, priceHistory } of market) {
    const change = scoreChanges[artist.id];
    if (change?.hasComparison && Math.abs(change.changeAbs) >= ALERT_SCORE_THRESHOLD) {
      const type: FeedEventType = change.changeAbs > 0 ? 'signal_score_up' : 'signal_score_down';
      created += maybePost(type, artist.id, cutoff, { scoreAfter: score, changeAbs: change.changeAbs });
    }

    const sentiment = marketSentiment(score, priceCents);
    if (sentiment.tone !== 'fair') {
      const type: FeedEventType = sentiment.tone === 'undervalued' ? 'signal_undervalued' : 'signal_overheated';
      created += maybePost(type, artist.id, cutoff, {
        diff: Math.round(sentiment.diff * 10) / 10,
        impliedScore: Math.round(sentiment.impliedScore * 10) / 10,
        actualScore: score,
      });
    }

    const changePct = changePctForWindow(priceCents, priceHistory, MOMENTUM_WINDOW_HOURS);
    if (Math.abs(changePct) >= ALERT_PRICE_PCT_THRESHOLD) {
      created += maybePost('market_momentum_mover', artist.id, cutoff, {
        changePct: Math.round(changePct * 10) / 10,
        windowHours: MOMENTUM_WINDOW_HOURS,
        priceCents,
      });
    }
  }

  const backerCounts = getRecentBackerCountsByArtist(MOMENTUM_WINDOW_HOURS);
  for (const [artistIdStr, count] of Object.entries(backerCounts)) {
    if (count < MIN_BACKERS_FOR_MOMENTUM) continue;
    created += maybePost('market_momentum_backers', Number(artistIdStr), cutoff, { backerCount: count, windowHours: MOMENTUM_WINDOW_HOURS });
  }

  const watchCounts = getRecentWatchCountsByArtist(MOMENTUM_WINDOW_HOURS);
  for (const [artistIdStr, count] of Object.entries(watchCounts)) {
    if (count < MIN_WATCHERS_FOR_MOMENTUM) continue;
    created += maybePost('market_momentum_most_watched', Number(artistIdStr), cutoff, { watchCount: count, windowHours: MOMENTUM_WINDOW_HOURS });
  }

  return { checked: market.length, created };
}
