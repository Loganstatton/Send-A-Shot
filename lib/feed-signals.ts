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
  createFeedEvent, getArtistTradeVolumeCentsInWindow, getNextMarket, getRecentBackerCountsByArtist,
  getRecentUserTakeCountsByArtist, getRecentWatchCountsByArtist, getScoreChanges, hasFeedEventSince,
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
// Exported so lib/feed-items.ts can score "how unusual is this
// market_momentum_* event" against the same numbers that decided whether
// to post it in the first place, instead of a second set of magic numbers.
export const MIN_BACKERS_FOR_MOMENTUM = 3;
export const MIN_WATCHERS_FOR_MOMENTUM = 5;
export const MOMENTUM_WINDOW_HOURS = 24;

// Pre-beta migration additions — same "explicit, tunable, one place"
// pattern as the constants above. Both windows are 7 days (a week), not
// MOMENTUM_WINDOW_HOURS's 24 hours — a single day of User Takes or trading
// volume is too noisy to call "discussed" or "moving" off of; a week
// smooths that out while still being recent.
export const DISCUSSION_WINDOW_HOURS = 7 * 24;
export const MIN_TAKES_FOR_MOMENTUM = 3;
export const VOLUME_WINDOW_HOURS = 7 * 24;
// Week-over-week % change required to post — only computed when the prior
// week actually had volume (see generateFeedSignals below): a 0 -> $50
// jump isn't a meaningful "+X%," it's just an artist's first real trading
// activity, and dividing by a $0 baseline would be either undefined or a
// misleadingly huge/infinite percentage. Never fabricates a signal for a
// thin/near-zero prior week just to have a number to show.
export const VOLUME_CHANGE_PCT_THRESHOLD = 40;

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
  // getNextMarket() already excludes stage='passed' artists internally —
  // no need (and, since NextMarketRow.artist is now the public-safe
  // projection, no way) to re-filter on .artist.stage here.
  const market = getNextMarket();
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

  const takeCounts = getRecentUserTakeCountsByArtist(DISCUSSION_WINDOW_HOURS);
  for (const [artistIdStr, count] of Object.entries(takeCounts)) {
    if (count < MIN_TAKES_FOR_MOMENTUM) continue;
    created += maybePost('market_momentum_most_discussed', Number(artistIdStr), cutoff, { takeCount: count, windowHours: DISCUSSION_WINDOW_HOURS });
  }

  // NEXT Volume: this week's trading volume vs the week before, per artist
  // still live on the market — only artists with real prior-week volume to
  // compare against (see VOLUME_CHANGE_PCT_THRESHOLD's own comment).
  for (const { artist } of market) {
    const priorWeekVolume = getArtistTradeVolumeCentsInWindow(artist.id, VOLUME_WINDOW_HOURS * 2, VOLUME_WINDOW_HOURS);
    if (priorWeekVolume <= 0) continue;
    const thisWeekVolume = getArtistTradeVolumeCentsInWindow(artist.id, VOLUME_WINDOW_HOURS, 0);
    const changePct = ((thisWeekVolume - priorWeekVolume) / priorWeekVolume) * 100;
    if (changePct < VOLUME_CHANGE_PCT_THRESHOLD) continue;
    created += maybePost('market_momentum_volume', artist.id, cutoff, {
      changePct: Math.round(changePct * 10) / 10, thisWeekVolumeCents: thisWeekVolume, priorWeekVolumeCents: priorWeekVolume, windowHours: VOLUME_WINDOW_HOURS,
    });
  }

  return { checked: market.length, created };
}
