import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

// Same isolation trick as lib/db.test.ts and lib/notifications.test.ts:
// DATA_DIR must be set before lib/db.ts (imported transitively by
// lib/analytics.ts) is ever imported, so this runs against a throwaway
// SQLite file that only this test file's own actions ever touch.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-test-'));

const { addToWatchlist, createArtist, createUser, db, executeTrade, logEvent, recordPreviewListen } = await import('./db');
const {
  getAvgArtistsViewedBeforeFirstTrade, getAvgTradesPerUser, getAvgWatchlistAddsPerUser, getGenreRetention,
  getMostEffectiveFilters, getPctTradesPrecededByListen, getRetention, getSessionAverages,
  getSignupConversionFunnel, getTimeToFirstTrade, getTopEngagementArtists,
} = await import('./analytics');

function makeUser(email: string) {
  return createUser({ name: 'Analytics Tester', email, password_hash: 'not-a-real-hash' });
}

function makeArtist(name: string, genre = 'Pop') {
  return createArtist({
    name, genre, music_talent: 8, growth_velocity_pct: 32, engagement_rate_pct: 16, original_song_response: 8,
    brand_personality: 8, content_consistency: 8, commercial_potential: 8, professionalism: 8,
  });
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

// Every timestamp-sensitive test below stamps its events at an explicit,
// JS-computed ISO time (never relying on two back-to-back "now" calls),
// since two calls this close together can land in the same millisecond —
// the exact race several other sections of this test suite already had to
// guard against for "before/after" and "within N minutes" comparisons.
function logEventAt(userId: number, eventType: Parameters<typeof logEvent>[1], metadata: Record<string, unknown> | undefined, isoTime: string) {
  logEvent(userId, eventType, metadata);
  const row = db.prepare('SELECT id FROM analytics_events WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(userId) as { id: number };
  db.prepare('UPDATE analytics_events SET created_at = ? WHERE id = ?').run(isoTime, row.id);
}

function viewArtistAt(userId: number, artistId: number, isoTime: string) {
  logEventAt(userId, 'artist_detail_opened', { artistId }, isoTime);
}

function tradeAt(userId: number, artistId: number, isoTime: string, creditsAmountCents = 100_000) {
  const result = executeTrade(userId, artistId, 'buy', creditsAmountCents);
  if (!result.ok) throw new Error(result.error);
  const row = db.prepare('SELECT id FROM next_transactions WHERE user_id = ? AND artist_id = ? ORDER BY id DESC LIMIT 1').get(userId, artistId) as { id: number };
  db.prepare('UPDATE next_transactions SET created_at = ? WHERE id = ?').run(isoTime, row.id);
  return result;
}

// This describe block MUST run before any other describe in this file logs
// an artist_detail_opened event or executes a trade — getAvgArtistsViewed
// BeforeFirstTrade and getSessionAverages both average across every user in
// the whole database with no per-user scoping, so an exact-value assertion
// is only meaningful while this test controls every contributing row.
// Every describe below this one either asserts via before/after delta,
// cross-checks against a direct SQL query of the current DB state, or is
// naturally isolated by a unique bucket key (artist id, genre, filter
// label) — all safe to run in any order relative to each other.
describe('whole-database averages seeded first', () => {
  it('getAvgArtistsViewedBeforeFirstTrade and getSessionAverages, computed exactly from this test\'s own activity', () => {
    const user = makeUser('first-mover@example.com');
    const artistA = makeArtist('First Mover Artist A');
    const artistB = makeArtist('First Mover Artist B');
    const base = Date.now();

    // Session 1 (a tight burst): views of A (twice) and B, all before the trade.
    viewArtistAt(user.id, artistA.id, new Date(base - 5000).toISOString());
    viewArtistAt(user.id, artistA.id, new Date(base - 4000).toISOString()); // repeat view of same artist — must not double-count
    viewArtistAt(user.id, artistB.id, new Date(base - 3000).toISOString());

    tradeAt(user.id, artistA.id, new Date(base - 2000).toISOString());

    // Session 2, 40 minutes later — past the 30-minute gap.
    viewArtistAt(user.id, artistA.id, new Date(base + 40 * 60 * 1000).toISOString());
    // Session 3, another 50 minutes after that — a second gap. This view
    // happens after the trade, so it must be excluded from the "viewed
    // before first trade" metric but still counted as its own session.
    viewArtistAt(user.id, artistB.id, new Date(base + 90 * 60 * 1000).toISOString());

    // Only A and B, both from session 1 (before the trade) — the post-trade
    // session-2/3 views don't count.
    expect(getAvgArtistsViewedBeforeFirstTrade()).toBe(2);

    const sessions = getSessionAverages();
    expect(sessions.artistViewSessionCount).toBe(3);
    // Session 1 saw 2 distinct artists (A, B), sessions 2 and 3 saw 1 each -> (2+1+1)/3.
    expect(sessions.avgArtistsViewedPerSession).toBeCloseTo(1.3, 1);
  });
});

describe('getSignupConversionFunnel', () => {
  it('counts each step of the funnel by distinct users, not by event count', () => {
    const before = getSignupConversionFunnel();
    const artist = makeArtist('Funnel Artist');
    const viewer = makeUser('funnel-viewer@example.com');
    const listener = makeUser('funnel-listener@example.com');
    const trader = makeUser('funnel-trader@example.com');

    logEvent(viewer.id, 'artist_detail_opened', { artistId: artist.id });
    logEvent(listener.id, 'artist_detail_opened', { artistId: artist.id });
    logEvent(listener.id, 'artist_detail_opened', { artistId: artist.id }); // second view by the same user must not double-count
    recordPreviewListen(listener.id, artist.id, 'started');
    recordPreviewListen(trader.id, artist.id, 'started');
    const trade = executeTrade(trader.id, artist.id, 'buy', 100_000);
    if (!trade.ok) throw new Error(trade.error);

    const after = getSignupConversionFunnel();
    expect(after.totalUsers - before.totalUsers).toBe(3);
    expect(after.viewedArtist - before.viewedArtist).toBe(2);
    expect(after.listened - before.listened).toBe(2);
    expect(after.traded - before.traded).toBe(1);
  });
});

describe('getTimeToFirstTrade', () => {
  it('is unaffected by a user\'s later trades, and tradedUserCount grows by exactly one new trader', () => {
    const before = getTimeToFirstTrade();
    const user = makeUser('first-trade-timing@example.com');
    const artist = makeArtist('Timing Artist');
    db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(daysAgoIso(2), user.id);

    tradeAt(user.id, artist.id, daysAgoIso(1));
    const afterFirst = getTimeToFirstTrade()!;
    expect(afterFirst.tradedUserCount).toBe((before?.tradedUserCount ?? 0) + 1);

    // A second, later trade by the same user must not shift "time to FIRST trade" at all.
    const secondTrade = executeTrade(user.id, artist.id, 'buy', 50_000);
    if (!secondTrade.ok) throw new Error(secondTrade.error);
    expect(getTimeToFirstTrade()).toEqual(afterFirst);
  });
});

describe('getPctTradesPrecededByListen', () => {
  it('reads next_transactions.listened_before_buy, stamped by executeTrade itself, matching a direct query', () => {
    const listener = makeUser('listened-before-buy@example.com');
    const impulsive = makeUser('impulsive-buy@example.com');
    const artist = makeArtist('Listen Precedence Artist');

    recordPreviewListen(listener.id, artist.id, 'started');
    const listenerBuy = executeTrade(listener.id, artist.id, 'buy', 100_000);
    if (!listenerBuy.ok) throw new Error(listenerBuy.error);

    const impulsiveBuy = executeTrade(impulsive.id, artist.id, 'buy', 100_000);
    if (!impulsiveBuy.ok) throw new Error(impulsiveBuy.error);

    const { total, preceded } = db
      .prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN listened_before_buy = 1 THEN 1 ELSE 0 END) AS preceded FROM next_transactions WHERE type = 'buy'")
      .get() as { total: number; preceded: number };
    expect(preceded).toBeGreaterThanOrEqual(1);
    expect(total).toBeGreaterThanOrEqual(2);
    expect(getPctTradesPrecededByListen()).toBe(Math.round((preceded / total) * 1000) / 10);
  });
});

describe('getAvgTradesPerUser / getAvgWatchlistAddsPerUser', () => {
  it('divides a whole-table count by total signups, matching a direct query', () => {
    const user = makeUser('ratio-user@example.com');
    const artist = makeArtist('Ratio Artist');
    const trade = executeTrade(user.id, artist.id, 'buy', 100_000);
    if (!trade.ok) throw new Error(trade.error);
    addToWatchlist(user.id, artist.id);
    logEvent(user.id, 'watchlist_added', { artistId: artist.id });

    const totalUsers = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
    const totalTrades = (db.prepare('SELECT COUNT(*) AS c FROM next_transactions').get() as { c: number }).c;
    const totalAdds = (db.prepare("SELECT COUNT(*) AS c FROM analytics_events WHERE event_type = 'watchlist_added'").get() as { c: number }).c;

    expect(getAvgTradesPerUser()).toBe(Math.round((totalTrades / totalUsers) * 100) / 100);
    expect(getAvgWatchlistAddsPerUser()).toBe(Math.round((totalAdds / totalUsers) * 100) / 100);
  });
});

describe('getRetention', () => {
  it('is null (not 0%) when no user has reached the window yet', () => {
    makeUser('too-new-for-retention@example.com');
    // Nothing in this file ever backdates a user 30+ days, so the day-30
    // window has genuinely not elapsed for anyone yet.
    const result = getRetention(30);
    expect(result.eligibleUsers).toBe(0);
    expect(result.pct).toBeNull();
  });

  it('counts a user retained only if activity lands inside the exact 24h window N days after signup', () => {
    const retained = makeUser('retained-user@example.com');
    const churned = makeUser('churned-user@example.com');

    // Both signed up 8 days ago, so the day-7 window (day 7 to day 8) has
    // already fully elapsed for both.
    const eightDaysAgo = daysAgoIso(8);
    db.prepare('UPDATE users SET created_at = ? WHERE id IN (?, ?)').run(eightDaysAgo, retained.id, churned.id);

    // Retained user: one activity event stamped inside the day-7 window.
    const withinWindow = new Date(new Date(eightDaysAgo).getTime() + 7.5 * 24 * 60 * 60 * 1000).toISOString();
    logEventAt(retained.id, 'discover_viewed', undefined, withinWindow);

    // Churned user: only activity is well before the window (at signup).
    logEventAt(churned.id, 'discover_viewed', undefined, eightDaysAgo);

    const result = getRetention(7);
    expect(result.eligibleUsers).toBe(2);
    expect(result.retainedUsers).toBe(1);
    expect(result.pct).toBe(50);
  });
});

describe('getMostEffectiveFilters', () => {
  it('counts a filter as a conversion only when the same user takes an action within 15 minutes', () => {
    const converter = makeUser('filter-converter@example.com');
    const abandoner = makeUser('filter-abandoner@example.com');
    const laggard = makeUser('filter-laggard@example.com');
    const artist = makeArtist('Filter Artist');
    const base = Date.now();

    logEventAt(converter.id, 'filter_used', { filter: 'genre' }, new Date(base).toISOString());
    viewArtistAt(converter.id, artist.id, new Date(base + 60 * 1000).toISOString()); // 1 min later -> converts

    logEventAt(abandoner.id, 'filter_used', { filter: 'genre' }, new Date(base).toISOString());
    // No follow-up action at all for this user -> not a conversion.

    logEventAt(laggard.id, 'filter_used', { filter: 'genre' }, new Date(base).toISOString());
    viewArtistAt(laggard.id, artist.id, new Date(base + 20 * 60 * 1000).toISOString()); // 20 min later -> outside the window

    const filters = getMostEffectiveFilters(1);
    const genreFilter = filters.find((f) => f.filter === 'genre')!;
    expect(genreFilter.uses).toBe(3);
    expect(genreFilter.conversions).toBe(1);
    expect(genreFilter.pct).toBeCloseTo(33.3, 1);
  });

  it('drops filters used fewer than minUses times', () => {
    const user = makeUser('rare-filter-user@example.com');
    logEvent(user.id, 'filter_used', { filter: 'genre_rare' });
    const filters = getMostEffectiveFilters(2);
    expect(filters.find((f) => f.filter === 'genre_rare')).toBeUndefined();
  });
});

describe('getTopEngagementArtists', () => {
  it('ranks artists by a weighted score: trades > watchlist adds > listens > views', () => {
    const user = makeUser('engagement-ranker@example.com');
    const highEngagement = makeArtist('High Engagement Artist');
    const lowEngagement = makeArtist('Low Engagement Artist');

    const trade = executeTrade(user.id, highEngagement.id, 'buy', 100_000);
    if (!trade.ok) throw new Error(trade.error);
    recordPreviewListen(user.id, highEngagement.id, 'started');
    logEvent(user.id, 'watchlist_added', { artistId: highEngagement.id });

    logEvent(user.id, 'artist_detail_opened', { artistId: lowEngagement.id });

    const results = getTopEngagementArtists(50);
    const high = results.find((a) => a.artistId === highEngagement.id)!;
    const low = results.find((a) => a.artistId === lowEngagement.id)!;
    expect(high.trades).toBe(1);
    expect(high.listens).toBe(1);
    expect(high.watchlistAdds).toBe(1);
    expect(low.views).toBe(1);
    expect(high.score).toBeGreaterThan(low.score);
    expect(results.indexOf(high)).toBeLessThan(results.indexOf(low));
  });
});

describe('getGenreRetention', () => {
  it('groups users by the genre of their first trade\'s artist, excluding users who never traded', () => {
    const rockArtist = makeArtist('Genre Retention Rock Artist', 'Rock');
    const rockFan = makeUser('rock-fan@example.com');
    makeUser('never-traded@example.com'); // no trade -> must not appear in any genre bucket

    const trade = executeTrade(rockFan.id, rockArtist.id, 'buy', 100_000);
    if (!trade.ok) throw new Error(trade.error);

    const genres = getGenreRetention();
    const rock = genres.find((g) => g.genre === 'Rock')!;
    expect(rock).toBeDefined();
    expect(rock.userCount).toBe(1);
  });
});
