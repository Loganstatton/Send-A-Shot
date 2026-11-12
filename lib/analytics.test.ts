import { describe, expect, it } from 'vitest';

// Runs in its own Postgres schema (see vitest.setup.ts), so only this
// file's own actions are ever counted.

const { addToWatchlist, createArtist, createUser, db, executeTrade, logEvent, recordPreviewListen } = await import('./db');
const {
  getAvgArtistsViewedBeforeFirstTrade, getAvgTradesPerUser, getAvgWatchlistAddsPerUser, getGenreRetention,
  getMostEffectiveFilters, getPctTradesPrecededByListen, getRetention, getSessionAverages,
  getSignupConversionFunnel, getTimeToFirstTrade, getTopEngagementArtists,
} = await import('./analytics');

async function makeUser(email: string) {
  return await createUser({ name: 'Analytics Tester', email, password_hash: 'not-a-real-hash' });
}

async function makeArtist(name: string, genre = 'Pop') {
  return await createArtist({
    name, genre, music_talent: 8, growth_velocity: 8, growth_velocity_pct: 32, engagement_quality: 8, engagement_rate_pct: 16,
    original_song_response: 8, brand_personality: 8, content_consistency: 8, commercial_potential: 8, professionalism: 8,
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
async function logEventAt(userId: number, eventType: Parameters<typeof logEvent>[1], metadata: Record<string, unknown> | undefined, isoTime: string) {
  await logEvent(userId, eventType, metadata);
  const row = await db.prepare('SELECT id FROM analytics_events WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(userId) as { id: number };
  await db.prepare('UPDATE analytics_events SET created_at = ? WHERE id = ?').run(isoTime, row.id);
}

async function viewArtistAt(userId: number, artistId: number, isoTime: string) {
  await logEventAt(userId, 'artist_detail_opened', { artistId }, isoTime);
}

async function tradeAt(userId: number, artistId: number, isoTime: string, creditsAmountCents = 100_000) {
  const result = await executeTrade(userId, artistId, 'buy', creditsAmountCents);
  if (!result.ok) throw new Error(result.error);
  const row = await db.prepare('SELECT id FROM next_transactions WHERE user_id = ? AND artist_id = ? ORDER BY id DESC LIMIT 1').get(userId, artistId) as { id: number };
  await db.prepare('UPDATE next_transactions SET created_at = ? WHERE id = ?').run(isoTime, row.id);
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
  it('getAvgArtistsViewedBeforeFirstTrade and getSessionAverages, computed exactly from this test\'s own activity', async () => {
    const user = await makeUser('first-mover@example.com');
    const artistA = await makeArtist('First Mover Artist A');
    const artistB = await makeArtist('First Mover Artist B');
    const base = Date.now();

    // Session 1 (a tight burst): views of A (twice) and B, all before the trade.
    await viewArtistAt(user.id, artistA.id, new Date(base - 5000).toISOString());
    await viewArtistAt(user.id, artistA.id, new Date(base - 4000).toISOString()); // repeat view of same artist — must not double-count
    await viewArtistAt(user.id, artistB.id, new Date(base - 3000).toISOString());

    await tradeAt(user.id, artistA.id, new Date(base - 2000).toISOString());

    // Session 2, 40 minutes later — past the 30-minute gap.
    await viewArtistAt(user.id, artistA.id, new Date(base + 40 * 60 * 1000).toISOString());
    // Session 3, another 50 minutes after that — a second gap. This view
    // happens after the trade, so it must be excluded from the "viewed
    // before first trade" metric but still counted as its own session.
    await viewArtistAt(user.id, artistB.id, new Date(base + 90 * 60 * 1000).toISOString());

    // Only A and B, both from session 1 (before the trade) — the post-trade
    // session-2/3 views don't count.
    expect(await getAvgArtistsViewedBeforeFirstTrade()).toBe(2);

    const sessions = await getSessionAverages();
    expect(sessions.artistViewSessionCount).toBe(3);
    // Session 1 saw 2 distinct artists (A, B), sessions 2 and 3 saw 1 each -> (2+1+1)/3.
    expect(sessions.avgArtistsViewedPerSession).toBeCloseTo(1.3, 1);
  });
});

describe('getSignupConversionFunnel', () => {
  it('counts each step of the funnel by distinct users, not by event count', async () => {
    const before = await getSignupConversionFunnel();
    const artist = await makeArtist('Funnel Artist');
    const viewer = await makeUser('funnel-viewer@example.com');
    const listener = await makeUser('funnel-listener@example.com');
    const trader = await makeUser('funnel-trader@example.com');

    await logEvent(viewer.id, 'artist_detail_opened', { artistId: artist.id });
    await logEvent(listener.id, 'artist_detail_opened', { artistId: artist.id });
    await logEvent(listener.id, 'artist_detail_opened', { artistId: artist.id }); // second view by the same user must not double-count
    await recordPreviewListen(listener.id, artist.id, 'started');
    await recordPreviewListen(trader.id, artist.id, 'started');
    const trade = await executeTrade(trader.id, artist.id, 'buy', 100_000);
    if (!trade.ok) throw new Error(trade.error);

    const after = await getSignupConversionFunnel();
    expect(after.totalUsers - before.totalUsers).toBe(3);
    expect(after.viewedArtist - before.viewedArtist).toBe(2);
    expect(after.listened - before.listened).toBe(2);
    expect(after.traded - before.traded).toBe(1);
  });
});

describe('getTimeToFirstTrade', () => {
  it('is unaffected by a user\'s later trades, and tradedUserCount grows by exactly one new trader', async () => {
    const before = await getTimeToFirstTrade();
    const user = await makeUser('first-trade-timing@example.com');
    const artist = await makeArtist('Timing Artist');
    await db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(daysAgoIso(2), user.id);

    await tradeAt(user.id, artist.id, daysAgoIso(1));
    const afterFirst = (await getTimeToFirstTrade())!;
    expect(afterFirst.tradedUserCount).toBe((before?.tradedUserCount ?? 0) + 1);

    // A second, later trade by the same user must not shift "time to FIRST trade" at all.
    const secondTrade = await executeTrade(user.id, artist.id, 'buy', 50_000);
    if (!secondTrade.ok) throw new Error(secondTrade.error);
    expect(await getTimeToFirstTrade()).toEqual(afterFirst);
  });
});

describe('getPctTradesPrecededByListen', () => {
  it('reads next_transactions.listened_before_buy, stamped by executeTrade itself, matching a direct query', async () => {
    const listener = await makeUser('listened-before-buy@example.com');
    const impulsive = await makeUser('impulsive-buy@example.com');
    const artist = await makeArtist('Listen Precedence Artist');

    await recordPreviewListen(listener.id, artist.id, 'started');
    const listenerBuy = await executeTrade(listener.id, artist.id, 'buy', 100_000);
    if (!listenerBuy.ok) throw new Error(listenerBuy.error);

    const impulsiveBuy = await executeTrade(impulsive.id, artist.id, 'buy', 100_000);
    if (!impulsiveBuy.ok) throw new Error(impulsiveBuy.error);

    const { total, preceded } = await db
      .prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN listened_before_buy = 1 THEN 1 ELSE 0 END) AS preceded FROM next_transactions WHERE type = 'buy'")
      .get() as { total: number; preceded: number };
    expect(preceded).toBeGreaterThanOrEqual(1);
    expect(total).toBeGreaterThanOrEqual(2);
    expect(await getPctTradesPrecededByListen()).toBe(Math.round((preceded / total) * 1000) / 10);
  });
});

describe('getAvgTradesPerUser / getAvgWatchlistAddsPerUser', () => {
  it('divides a whole-table count by total signups, matching a direct query', async () => {
    const user = await makeUser('ratio-user@example.com');
    const artist = await makeArtist('Ratio Artist');
    const trade = await executeTrade(user.id, artist.id, 'buy', 100_000);
    if (!trade.ok) throw new Error(trade.error);
    await addToWatchlist(user.id, artist.id);
    await logEvent(user.id, 'watchlist_added', { artistId: artist.id });

    const totalUsers = (await db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
    const totalTrades = (await db.prepare('SELECT COUNT(*) AS c FROM next_transactions').get() as { c: number }).c;
    const totalAdds = (await db.prepare("SELECT COUNT(*) AS c FROM analytics_events WHERE event_type = 'watchlist_added'").get() as { c: number }).c;

    expect(await getAvgTradesPerUser()).toBe(Math.round((totalTrades / totalUsers) * 100) / 100);
    expect(await getAvgWatchlistAddsPerUser()).toBe(Math.round((totalAdds / totalUsers) * 100) / 100);
  });
});

describe('getRetention', () => {
  it('is null (not 0%) when no user has reached the window yet', async () => {
    await makeUser('too-new-for-retention@example.com');
    // Nothing in this file ever backdates a user 30+ days, so the day-30
    // window has genuinely not elapsed for anyone yet.
    const result = await getRetention(30);
    expect(result.eligibleUsers).toBe(0);
    expect(result.pct).toBeNull();
  });

  it('counts a user retained only if activity lands inside the exact 24h window N days after signup', async () => {
    const retained = await makeUser('retained-user@example.com');
    const churned = await makeUser('churned-user@example.com');

    // Both signed up 8 days ago, so the day-7 window (day 7 to day 8) has
    // already fully elapsed for both.
    const eightDaysAgo = daysAgoIso(8);
    await db.prepare('UPDATE users SET created_at = ? WHERE id IN (?, ?)').run(eightDaysAgo, retained.id, churned.id);

    // Retained user: one activity event stamped inside the day-7 window.
    const withinWindow = new Date(new Date(eightDaysAgo).getTime() + 7.5 * 24 * 60 * 60 * 1000).toISOString();
    await logEventAt(retained.id, 'discover_viewed', undefined, withinWindow);

    // Churned user: only activity is well before the window (at signup).
    await logEventAt(churned.id, 'discover_viewed', undefined, eightDaysAgo);

    const result = await getRetention(7);
    expect(result.eligibleUsers).toBe(2);
    expect(result.retainedUsers).toBe(1);
    expect(result.pct).toBe(50);
  });
});

describe('getMostEffectiveFilters', () => {
  it('counts a filter as a conversion only when the same user takes an action within 15 minutes', async () => {
    const converter = await makeUser('filter-converter@example.com');
    const abandoner = await makeUser('filter-abandoner@example.com');
    const laggard = await makeUser('filter-laggard@example.com');
    const artist = await makeArtist('Filter Artist');
    const base = Date.now();

    await logEventAt(converter.id, 'filter_used', { filter: 'genre' }, new Date(base).toISOString());
    await viewArtistAt(converter.id, artist.id, new Date(base + 60 * 1000).toISOString()); // 1 min later -> converts

    await logEventAt(abandoner.id, 'filter_used', { filter: 'genre' }, new Date(base).toISOString());
    // No follow-up action at all for this user -> not a conversion.

    await logEventAt(laggard.id, 'filter_used', { filter: 'genre' }, new Date(base).toISOString());
    await viewArtistAt(laggard.id, artist.id, new Date(base + 20 * 60 * 1000).toISOString()); // 20 min later -> outside the window

    const filters = await getMostEffectiveFilters(1);
    const genreFilter = filters.find((f) => f.filter === 'genre')!;
    expect(genreFilter.uses).toBe(3);
    expect(genreFilter.conversions).toBe(1);
    expect(genreFilter.pct).toBeCloseTo(33.3, 1);
  });

  it('drops filters used fewer than minUses times', async () => {
    const user = await makeUser('rare-filter-user@example.com');
    await logEvent(user.id, 'filter_used', { filter: 'genre_rare' });
    const filters = await getMostEffectiveFilters(2);
    expect(filters.find((f) => f.filter === 'genre_rare')).toBeUndefined();
  });
});

describe('getTopEngagementArtists', () => {
  it('ranks artists by a weighted score: trades > watchlist adds > listens > views', async () => {
    const user = await makeUser('engagement-ranker@example.com');
    const highEngagement = await makeArtist('High Engagement Artist');
    const lowEngagement = await makeArtist('Low Engagement Artist');

    const trade = await executeTrade(user.id, highEngagement.id, 'buy', 100_000);
    if (!trade.ok) throw new Error(trade.error);
    await recordPreviewListen(user.id, highEngagement.id, 'started');
    await logEvent(user.id, 'watchlist_added', { artistId: highEngagement.id });

    await logEvent(user.id, 'artist_detail_opened', { artistId: lowEngagement.id });

    const results = await getTopEngagementArtists(50);
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
  it('groups users by the genre of their first trade\'s artist, excluding users who never traded', async () => {
    const rockArtist = await makeArtist('Genre Retention Rock Artist', 'Rock');
    const rockFan = await makeUser('rock-fan@example.com');
    await makeUser('never-traded@example.com'); // no trade -> must not appear in any genre bucket

    const trade = await executeTrade(rockFan.id, rockArtist.id, 'buy', 100_000);
    if (!trade.ok) throw new Error(trade.error);

    const genres = await getGenreRetention();
    const rock = genres.find((g) => g.genre === 'Rock')!;
    expect(rock).toBeDefined();
    expect(rock.userCount).toBe(1);
  });
});
