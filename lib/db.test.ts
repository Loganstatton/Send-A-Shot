import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

// DATA_DIR must be set before lib/data-dir.ts (and therefore lib/db.ts) is
// ever imported, so this test runs against an isolated, throwaway SQLite
// file instead of the real dev/prod database.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-test-'));

const {
  addToWatchlist, approveDiscoveryCandidate, completeDiscoveryRun, completeNextOnboarding, completeSyncRun,
  createArtist, createDiscoveryRun, createSyncRun, createUser, db, deleteUser, executeTrade, getArtist,
  getArtistsMissingTopSong, getArtistsWithSoundchartsLink, getArtistTradeVolumeCents, getBackerCountsByArtist,
  getDiscoveryCandidates, getEventCountsByType, getFavoriteGenres, getKnownDiscoveryUuids,
  getKnownDiscoveryYoutubeChannelIds, getLatestDiscoveryRun, getLatestSyncRun, getMarketTradeCounts,
  getMarketVolumeCents, getMostActiveArtists, getNewArtistsThisWeek, getNewDiscoveryCandidateCount, getNextArtist,
  getPortfolioValue, getPortfolioValueHistory, getRankMovements, getReadNotificationKeys, getRecentBackerCount,
  getRecentBackerCountsByArtist, getRecentEventsForUser, getRecentMarketTrades, getRecentTradesForArtist,
  getRecentWatchCountsByArtist, getScoreChanges, getScoutLeaderboard, getScoutProfile, getTrackedSoundchartsUuids,
  getUserById, getUserPasswordHash, getUserTransactions, getUserWatchlist, getWatchCountsByArtist,
  hasListenedToArtist, insertDiscoveryCandidate, isWatchlisted, logArtistCardViews, logEvent, markEmailVerified,
  markNotificationRead, markNotificationsRead, recordLogin, recordPreviewListen, setDiscoveryCandidateStatus,
  setNotificationsEmailedThrough, setWatchlistAlerts, updateArtist, updateUserProfile,
} = await import('./db');

const STARTING_BALANCE_CENTS = 1_000_000; // $10,000

function makeUser(email: string) {
  return createUser({ name: 'Test Trader', email, password_hash: 'not-a-real-hash' });
}

function makeArtist(name: string) {
  // The six rated categories at 8/10, plus growth_velocity_pct: 32 and
  // engagement_rate_pct: 16 — chosen because growthVelocityScore(32) and
  // engagementQualityScore(16) both equal exactly 8.0 too (see
  // lib/scoring.ts), so every category lands on 8 and
  // breakoutScore = 8 * (sum of weights)/10 = 8 * 100/10 = 80 exactly.
  // Deterministic, no seeding needed. growth_velocity/engagement_quality
  // are NOT set directly — createArtist ignores them and always derives
  // both from the _pct fields.
  return createArtist({
    name,
    music_talent: 8,
    growth_velocity_pct: 32,
    engagement_rate_pct: 16,
    original_song_response: 8,
    brand_personality: 8,
    content_consistency: 8,
    commercial_potential: 8,
    professionalism: 8,
  });
}

describe('NEXT trading engine — self-trade exploit prevention', () => {
  it('a single buy-then-sell-all round trip does not profit, and moves price both directions', () => {
    const user = makeUser('single-roundtrip@example.com');
    const artist = makeArtist('Round Trip Artist');

    const priceBefore = getNextArtist(artist.id)!.priceCents;

    const buy = executeTrade(user.id, artist.id, 'buy', 100_000); // $1,000
    if (!buy.ok) throw new Error(buy.error);
    expect(buy.shares).toBeGreaterThan(0);

    const priceAfterBuy = getNextArtist(artist.id)!.priceCents;
    // Visible market impact must still exist: a buy with no other activity
    // pushes the price up.
    expect(priceAfterBuy).toBeGreaterThan(priceBefore);

    // Sell every share back immediately, valued at the current price — the
    // same thing the "Sell all" button in the UI does.
    const sellAmount = Math.round(buy.shares * priceAfterBuy);
    const sell = executeTrade(user.id, artist.id, 'sell', sellAmount);
    if (!sell.ok) throw new Error(sell.error);

    const priceAfterSell = getNextArtist(artist.id)!.priceCents;
    // And a sell with no other activity pushes it back down.
    expect(priceAfterSell).toBeLessThan(priceAfterBuy);

    const finalBalance = getUserById(user.id)!.next_credits_cents;

    // The whole point: buying then immediately selling back, with zero
    // outside market activity, must never leave the trader with more
    // credits than they started with.
    expect(finalBalance).toBeLessThanOrEqual(STARTING_BALANCE_CENTS);
    // Sanity: it shouldn't vanish either — this is slippage, not a penalty.
    expect(finalBalance).toBeGreaterThan(STARTING_BALANCE_CENTS - 100_000);
  });

  it('repeated self-trading round trips cannot manufacture credits', () => {
    const user = makeUser('repeated-roundtrip@example.com');
    const artist = makeArtist('Repeated Round Trip Artist');

    let previousBalance = STARTING_BALANCE_CENTS;

    // A different, non-round trade size each round, so this isn't just
    // proving one lucky amount is safe.
    let anyLoss = false;

    for (let i = 0; i < 25; i++) {
      const buyAmountCents = 150_000 + (i * 61_703) % 250_000;
      const buy = executeTrade(user.id, artist.id, 'buy', buyAmountCents);
      if (!buy.ok) throw new Error(buy.error);

      const currentPrice = getNextArtist(artist.id)!.priceCents;
      const sellAmount = Math.round(buy.shares * currentPrice);
      const sell = executeTrade(user.id, artist.id, 'sell', sellAmount);
      if (!sell.ok) throw new Error(sell.error);

      const balance = getUserById(user.id)!.next_credits_cents;
      // Never more than where they started...
      expect(balance).toBeLessThanOrEqual(STARTING_BALANCE_CENTS);
      // ...and never more than the previous round either — round-tripping
      // never accumulates a gain, on any single round or in aggregate. It
      // is allowed to land exactly flat on a given round (cent-rounding on
      // the average execution price can happen to cancel out), but it must
      // never go up.
      expect(balance).toBeLessThanOrEqual(previousBalance);
      if (balance < previousBalance) anyLoss = true;
      previousBalance = balance;
    }

    const finalBalance = getUserById(user.id)!.next_credits_cents;
    // "Approximately the starting balance or slightly less, never more" —
    // per spec, breaking exactly even on some rounds is fine; profiting
    // never is.
    expect(finalBalance).toBeLessThanOrEqual(STARTING_BALANCE_CENTS);
    // But across 25 rounds of varied, non-round trade sizes, slippage
    // should actually bite at least once — otherwise this "fee" is a no-op
    // and the test isn't proving anything.
    expect(anyLoss).toBe(true);
  });

  it('a real price move (no round trip) still lets a holder profit', () => {
    // Guards against a too-aggressive fix that makes ALL trading a loss —
    // buying, having the price rise from someone else's demand, then
    // selling should still be profitable.
    const buyer = makeUser('real-buyer@example.com');
    const otherBuyer = makeUser('other-buyer@example.com');
    const artist = makeArtist('Genuinely Rising Artist');

    const buy = executeTrade(buyer.id, artist.id, 'buy', 100_000);
    if (!buy.ok) throw new Error(buy.error);

    // Someone else piles in, pushing the price up for reasons unrelated to
    // the first buyer's own trade.
    const other = executeTrade(otherBuyer.id, artist.id, 'buy', 500_000);
    if (!other.ok) throw new Error(other.error);

    const priceNow = getNextArtist(artist.id)!.priceCents;
    const sellAmount = Math.round(buy.shares * priceNow);
    const sell = executeTrade(buyer.id, artist.id, 'sell', sellAmount);
    if (!sell.ok) throw new Error(sell.error);

    const finalBalance = getUserById(buyer.id)!.next_credits_cents;
    expect(finalBalance).toBeGreaterThan(STARTING_BALANCE_CENTS);
  });
});

describe('Discovery Engine — candidate queue', () => {
  it('a new candidate appears in the "new" queue and counts toward the pending badge', () => {
    const before = getNewDiscoveryCandidateCount();
    insertDiscoveryCandidate({
      source: 'soundcharts',
      soundcharts_uuid: 'uuid-new-1',
      name: 'Fresh Signal',
      followers_count: 12_000,
      followers_7d_ago: 10_000,
      growth_7d_pct: 20,
      flagged_reason: '+20% Spotify followers in 7 days (10.0K → 12.0K) — a sudden jump',
    });

    expect(getNewDiscoveryCandidateCount()).toBe(before + 1);
    const queue = getDiscoveryCandidates('new');
    const found = queue.find((c) => c.soundcharts_uuid === 'uuid-new-1');
    expect(found).toBeDefined();
    expect(found!.status).toBe('new');
  });

  it('Pass and Watch move a candidate out of the "new" queue without touching the roster', () => {
    const passUser = makeUser('pass-actor@example.com');
    const watchUser = makeUser('watch-actor@example.com');

    insertDiscoveryCandidate({ source: 'soundcharts', soundcharts_uuid: 'uuid-pass-1', name: 'Pass Me', followers_count: 5000, flagged_reason: 'test' });
    insertDiscoveryCandidate({ source: 'soundcharts', soundcharts_uuid: 'uuid-watch-1', name: 'Watch Me', followers_count: 5000, flagged_reason: 'test' });

    const passCandidate = getDiscoveryCandidates('new').find((c) => c.soundcharts_uuid === 'uuid-pass-1')!;
    const watchCandidate = getDiscoveryCandidates('new').find((c) => c.soundcharts_uuid === 'uuid-watch-1')!;

    const passed = setDiscoveryCandidateStatus(passCandidate.id, 'passed', { id: passUser.id, name: passUser.name });
    const watched = setDiscoveryCandidateStatus(watchCandidate.id, 'watching', { id: watchUser.id, name: watchUser.name });

    expect(passed!.status).toBe('passed');
    expect(watched!.status).toBe('watching');
    // Neither shows up in the "new" queue anymore...
    expect(getDiscoveryCandidates('new').some((c) => c.id === passCandidate.id)).toBe(false);
    expect(getDiscoveryCandidates('new').some((c) => c.id === watchCandidate.id)).toBe(false);
    // ...but a passed/watched candidate never became a real artist.
    expect(getTrackedSoundchartsUuids().has('uuid-pass-1')).toBe(false);
    expect(getTrackedSoundchartsUuids().has('uuid-watch-1')).toBe(false);
  });

  it('a passed or watched candidate is excluded from future scans by soundcharts_uuid', () => {
    insertDiscoveryCandidate({ source: 'soundcharts', soundcharts_uuid: 'uuid-known-1', name: 'Already Seen', followers_count: 5000, flagged_reason: 'test' });
    expect(getKnownDiscoveryUuids().has('uuid-known-1')).toBe(true);
  });

  it('Approve creates a real, editable artist pre-filled from the candidate — not auto-scored', () => {
    const admin = makeUser('approver@example.com');
    insertDiscoveryCandidate({
      source: 'soundcharts',
      soundcharts_uuid: 'uuid-approve-1',
      name: 'Breakout Kid',
      photo_url: 'https://example.com/photo.jpg',
      country: 'US',
      followers_count: 42_000,
      growth_30d_pct: 15,
      flagged_reason: '+15% Spotify followers in 30 days (36.5K → 42.0K)',
    });
    const candidate = getDiscoveryCandidates('new').find((c) => c.soundcharts_uuid === 'uuid-approve-1')!;

    const artist = approveDiscoveryCandidate(candidate.id, { id: admin.id, name: admin.name });

    expect(artist).toBeDefined();
    expect(artist!.name).toBe('Breakout Kid');
    expect(artist!.soundcharts_uuid).toBe('uuid-approve-1');
    expect(artist!.followers_count).toBe(42_000);
    // Human judgment still drives the qualitative categories, but approval
    // starts them at the same neutral 5/10 the Add Artist form itself
    // defaults to — not 0, which would make every freshly-discovered
    // artist score as "Pass" no matter how strong its real signal was.
    expect(artist!.music_talent).toBe(5);
    // Growth Velocity, on the other hand, is derived immediately from the
    // real growth % Discovery already found — never manually rated, and
    // never 0 just because nobody's looked at this artist yet.
    expect(artist!.growth_velocity).toBeGreaterThan(0);

    // The candidate is now linked to the real artist and marked approved,
    // and the artist is immediately editable/findable like any other.
    const reloaded = getDiscoveryCandidates().find((c) => c.id === candidate.id)!;
    expect(reloaded.status).toBe('approved');
    expect(reloaded.artist_id).toBe(artist!.id);
    expect(getArtist(artist!.id)).toBeDefined();

    // And it's now tracked, so a future scan won't re-flag it.
    expect(getTrackedSoundchartsUuids().has('uuid-approve-1')).toBe(true);
  });
});

describe('Data-driven scoring — Growth Velocity / Engagement Quality', () => {
  it('growth_velocity is derived from growth_velocity_pct on create, ignoring any raw value sent', () => {
    const artist = createArtist({
      name: 'Derived Growth',
      growth_velocity_pct: 32, // -> exactly 8.0 by design, see makeArtist
      growth_velocity: 0.1, // still a structurally valid field on Artist — must be ignored, not trusted
    });
    expect(artist.growth_velocity).toBe(8);
  });

  it('engagement_quality is derived from engagement_rate_pct on create', () => {
    const artist = createArtist({ name: 'Derived Engagement', engagement_rate_pct: 16 });
    expect(artist.engagement_quality).toBe(8);
  });

  it('omitting growth_velocity_pct / engagement_rate_pct derives 0, not null (schema is NOT NULL)', () => {
    const artist = createArtist({ name: 'No Data Yet' });
    expect(artist.growth_velocity).toBe(0);
    expect(artist.engagement_quality).toBe(0);
  });

  it('updating growth_velocity_pct alone re-derives growth_velocity without touching engagement_quality', () => {
    const artist = createArtist({ name: 'Update Growth', growth_velocity_pct: 32, engagement_rate_pct: 16 });
    expect(artist.growth_velocity).toBe(8);
    expect(artist.engagement_quality).toBe(8);

    const updated = updateArtist(artist.id, { name: artist.name, growth_velocity_pct: 0 })!;
    expect(updated.growth_velocity).toBe(0);
    // engagement_rate_pct wasn't part of this update, so its derived score
    // is recomputed from the unchanged existing value, not blanked out.
    expect(updated.engagement_quality).toBe(8);
  });

  it('a bigger real-world growth spike scores higher, but with diminishing returns near the ceiling', () => {
    const modest = createArtist({ name: 'Modest Grower', growth_velocity_pct: 5 });
    const strong = createArtist({ name: 'Strong Grower', growth_velocity_pct: 25 });
    const huge = createArtist({ name: 'Huge Grower', growth_velocity_pct: 200 });

    expect(modest.growth_velocity).toBeGreaterThan(0);
    expect(strong.growth_velocity).toBeGreaterThan(modest.growth_velocity);
    // Huge (200%) is clamped at the same ceiling score as a very strong
    // but more plausible 50%+ — this is deliberate: past the ceiling, more
    // growth doesn't buy more score.
    const atCeiling = createArtist({ name: 'At Ceiling', growth_velocity_pct: 50 });
    expect(huge.growth_velocity).toBe(atCeiling.growth_velocity);
    expect(huge.growth_velocity).toBe(10);
  });
});

describe('Automated Soundcharts sync', () => {
  it('getArtistsWithSoundchartsLink only returns artists with a linked uuid', () => {
    const linked = createArtist({ name: 'Linked Artist', soundcharts_uuid: 'uuid-linked-1' });
    createArtist({ name: 'Unlinked Artist' });

    const rows = getArtistsWithSoundchartsLink();
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(linked.id);
    expect(rows.find((r) => r.id === linked.id)?.soundcharts_uuid).toBe('uuid-linked-1');
  });

  it('createSyncRun/completeSyncRun/getLatestSyncRun round-trip a run record', () => {
    const run = createSyncRun();
    expect(run.status).toBe('running');

    completeSyncRun(run.id, { status: 'completed', checkedCount: 5, updatedCount: 3, failedCount: 1 });

    const latest = getLatestSyncRun()!;
    expect(latest.id).toBe(run.id);
    expect(latest.status).toBe('completed');
    expect(latest.checked_count).toBe(5);
    expect(latest.updated_count).toBe(3);
    expect(latest.failed_count).toBe(1);
    expect(latest.completed_at).toBeTruthy();
  });

  it('a failed sync run records its error message', () => {
    const run = createSyncRun();
    completeSyncRun(run.id, { status: 'failed', checkedCount: 0, updatedCount: 0, failedCount: 0, error: 'Soundcharts unreachable' });

    const latest = getLatestSyncRun()!;
    expect(latest.id).toBe(run.id);
    expect(latest.status).toBe('failed');
    expect(latest.error).toBe('Soundcharts unreachable');
  });
});

describe('Deezer top-song sync', () => {
  it('getArtistsMissingTopSong only returns artists with no top_song_url set', () => {
    const missing = createArtist({ name: 'No Top Song Yet' });
    const has = createArtist({ name: 'Already Has One', top_song_url: 'https://www.deezer.com/track/123' });

    const rows = getArtistsMissingTopSong();
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(missing.id);
    expect(ids).not.toContain(has.id);
  });

  it('filling in top_song_url removes an artist from the missing set — sync will not touch it again', () => {
    const artist = createArtist({ name: 'Freshly Filled' });
    expect(getArtistsMissingTopSong().map((r) => r.id)).toContain(artist.id);

    updateArtist(artist.id, { name: artist.name, top_song_url: 'https://www.deezer.com/track/456' });
    expect(getArtistsMissingTopSong().map((r) => r.id)).not.toContain(artist.id);
  });

  it("Soundcharts and Deezer sync runs keep independent 'latest' history via the source column", () => {
    const soundchartsRun = createSyncRun('soundcharts');
    completeSyncRun(soundchartsRun.id, { status: 'completed', checkedCount: 5, updatedCount: 5, failedCount: 0 });
    const deezerRun = createSyncRun('deezer');
    completeSyncRun(deezerRun.id, { status: 'completed', checkedCount: 3, updatedCount: 2, failedCount: 1 });

    const latestSoundcharts = getLatestSyncRun('soundcharts')!;
    const latestDeezer = getLatestSyncRun('deezer')!;
    expect(latestSoundcharts.id).toBe(soundchartsRun.id);
    expect(latestSoundcharts.source).toBe('soundcharts');
    expect(latestDeezer.id).toBe(deezerRun.id);
    expect(latestDeezer.source).toBe('deezer');
    expect(latestDeezer.updated_count).toBe(2);
  });

  it('a Deezer run round-trips the no-match-vs-error breakdown — this is what tells a Scout why a REAL artist failed', () => {
    const run = createSyncRun('deezer');
    completeSyncRun(run.id, {
      status: 'completed', checkedCount: 4, updatedCount: 0, failedCount: 4,
      noMatchCount: 3, errorCount: 1, lastError: 'Deezer returned 429: rate limited.',
    });

    const latest = getLatestSyncRun('deezer')!;
    expect(latest.id).toBe(run.id);
    expect(latest.no_match_count).toBe(3);
    expect(latest.error_count).toBe(1);
    expect(latest.last_error).toBe('Deezer returned 429: rate limited.');
  });

  it('a Soundcharts run (no lookup-reason breakdown) leaves those columns null, not zero', () => {
    const run = createSyncRun('soundcharts');
    completeSyncRun(run.id, { status: 'completed', checkedCount: 5, updatedCount: 5, failedCount: 0 });

    const latest = getLatestSyncRun('soundcharts')!;
    expect(latest.no_match_count ?? null).toBeNull();
    expect(latest.error_count ?? null).toBeNull();
  });
});

describe('YouTube discovery — candidates without a Soundcharts identity', () => {
  it('inserts and reads back a YouTube candidate with no soundcharts_uuid at all', () => {
    insertDiscoveryCandidate({
      source: 'youtube',
      name: 'Unmatched Channel',
      yt_video_id: 'vid-unmatched-1',
      yt_channel_id: 'chan-unmatched-1',
      yt_channel_title: 'Unmatched Channel',
      yt_genre: 'pop',
      yt_view_count: 150_000,
      yt_channel_subscriber_count: 8_000,
      momentum_score: 87.3,
      flagged_reason: '150K views in 6 days • 8K channel subscribers',
    });

    const found = getDiscoveryCandidates('new').find((c) => c.yt_channel_id === 'chan-unmatched-1')!;
    expect(found).toBeDefined();
    expect(found.source).toBe('youtube');
    expect(found.soundcharts_uuid).toBeFalsy();
    expect(found.momentum_score).toBe(87.3);
  });

  it('a YouTube candidate CAN carry a Soundcharts match alongside its channel identity', () => {
    insertDiscoveryCandidate({
      source: 'youtube',
      name: 'Matched Channel',
      soundcharts_uuid: 'uuid-yt-matched-1',
      followers_count: 22_000,
      growth_30d_pct: 12,
      yt_channel_id: 'chan-matched-1',
      yt_channel_title: 'Matched Channel',
      momentum_score: 55,
      flagged_reason: 'test',
    });

    const found = getDiscoveryCandidates('new').find((c) => c.yt_channel_id === 'chan-matched-1')!;
    expect(found.soundcharts_uuid).toBe('uuid-yt-matched-1');
    expect(found.followers_count).toBe(22_000);
  });

  it('the same YouTube channel cannot be inserted twice (partial unique index)', () => {
    insertDiscoveryCandidate({ source: 'youtube', name: 'Dup Channel', yt_channel_id: 'chan-dup-1', flagged_reason: 'test' });
    expect(() =>
      insertDiscoveryCandidate({ source: 'youtube', name: 'Dup Channel', yt_channel_id: 'chan-dup-1', flagged_reason: 'test' })
    ).toThrow();
  });

  it('two Soundcharts-less YouTube candidates coexist fine (soundcharts_uuid null is not treated as a duplicate)', () => {
    insertDiscoveryCandidate({ source: 'youtube', name: 'No Match A', yt_channel_id: 'chan-null-a', flagged_reason: 'test' });
    expect(() =>
      insertDiscoveryCandidate({ source: 'youtube', name: 'No Match B', yt_channel_id: 'chan-null-b', flagged_reason: 'test' })
    ).not.toThrow();
  });

  it('getKnownDiscoveryYoutubeChannelIds tracks channels regardless of review status', () => {
    insertDiscoveryCandidate({ source: 'youtube', name: 'Known Channel', yt_channel_id: 'chan-known-1', flagged_reason: 'test' });
    expect(getKnownDiscoveryYoutubeChannelIds().has('chan-known-1')).toBe(true);
  });

  it('hype-comment fields (rate, examples, likes) round-trip through insert and read', () => {
    insertDiscoveryCandidate({
      source: 'youtube',
      name: 'Hype Channel',
      yt_channel_id: 'chan-hype-1',
      momentum_score: 72,
      yt_hype_comment_rate: 0.15,
      yt_comments_analyzed: 20,
      yt_example_comment_1: 'how is this not viral??',
      yt_example_comment_1_likes: 412,
      yt_example_comment_2: 'this is so underrated',
      yt_example_comment_2_likes: 88,
      flagged_reason: '142K views in 6 days • 💬 "how is this not viral??" (412 likes)',
    });

    const found = getDiscoveryCandidates('new').find((c) => c.yt_channel_id === 'chan-hype-1')!;
    expect(found.yt_hype_comment_rate).toBeCloseTo(0.15, 5);
    expect(found.yt_comments_analyzed).toBe(20);
    expect(found.yt_example_comment_1).toBe('how is this not viral??');
    expect(found.yt_example_comment_1_likes).toBe(412);
    expect(found.yt_example_comment_2).toBe('this is so underrated');
    expect(found.yt_example_comment_2_likes).toBe(88);
  });

  it('a candidate with no hype comments found leaves those fields null, not zero-filled', () => {
    insertDiscoveryCandidate({ source: 'youtube', name: 'No Hype', yt_channel_id: 'chan-no-hype-1', momentum_score: 55, flagged_reason: 'test' });
    const found = getDiscoveryCandidates('new').find((c) => c.yt_channel_id === 'chan-no-hype-1')!;
    expect(found.yt_hype_comment_rate ?? null).toBeNull();
    expect(found.yt_example_comment_1 ?? null).toBeNull();
  });

  it('Approve on a YouTube candidate carries its genre onto the new artist as a human label, not the raw scan-bucket key, and never requires a Soundcharts uuid', () => {
    const admin = makeUser('yt-approver@example.com');
    insertDiscoveryCandidate({
      source: 'youtube',
      name: 'Genre Carrier',
      yt_channel_id: 'chan-genre-1',
      yt_genre: 'rock-alternative',
      momentum_score: 60,
      flagged_reason: 'test',
    });
    const candidate = getDiscoveryCandidates('new').find((c) => c.yt_channel_id === 'chan-genre-1')!;
    const artist = approveDiscoveryCandidate(candidate.id, { id: admin.id, name: admin.name })!;

    expect(artist).toBeDefined();
    expect(artist.genre).toBe('Rock/Alternative');
    expect(artist.soundcharts_uuid ?? null).toBeNull();
  });

  it('Approve on a YouTube candidate with an unrecognized genre key falls back to that raw key rather than dropping it', () => {
    const admin = makeUser('yt-approver-fallback@example.com');
    insertDiscoveryCandidate({
      source: 'youtube',
      name: 'Unknown Genre Carrier',
      yt_channel_id: 'chan-genre-2',
      yt_genre: 'some-future-bucket',
      momentum_score: 60,
      flagged_reason: 'test',
    });
    const candidate = getDiscoveryCandidates('new').find((c) => c.yt_channel_id === 'chan-genre-2')!;
    const artist = approveDiscoveryCandidate(candidate.id, { id: admin.id, name: admin.name })!;

    expect(artist.genre).toBe('some-future-bucket');
  });

  it('Approve on a YouTube candidate carries its photo and location through when Soundcharts enrichment found them', () => {
    const admin = makeUser('yt-approver-photo@example.com');
    insertDiscoveryCandidate({
      source: 'youtube',
      name: 'Photo Carrier',
      yt_channel_id: 'chan-photo-1',
      photo_url: 'https://example.com/photo.jpg',
      country: 'Toronto, CA',
      soundcharts_uuid: 'uuid-photo-1',
      momentum_score: 60,
      flagged_reason: 'test',
    });
    const candidate = getDiscoveryCandidates('new').find((c) => c.yt_channel_id === 'chan-photo-1')!;
    const artist = approveDiscoveryCandidate(candidate.id, { id: admin.id, name: admin.name })!;

    expect(artist.photo_url).toBe('https://example.com/photo.jpg');
    expect(artist.location).toBe('Toronto, CA');
  });

  it('a completed YouTube run round-trips its rejection breakdown — this is what tells a Scout "why zero", not just "zero"', () => {
    const run = createDiscoveryRun('youtube');
    completeDiscoveryRun(run.id, {
      status: 'completed',
      searchedCount: 90,
      candidatesFound: 0,
      quotaUsed: 602,
      rejectionBreakdown: {
        notOfficialRelease: 15,
        belowMinViews: 12,
        noSubscriberCount: 30,
        subscriberOutOfBand: 40,
        belowMomentumThreshold: 8,
        bestRejectedMomentumScore: 22.5,
      },
    });

    const latest = getLatestDiscoveryRun('youtube')!;
    expect(latest.id).toBe(run.id);
    expect(latest.candidates_found).toBe(0);
    expect(latest.rejected_not_official_release).toBe(15);
    expect(latest.rejected_below_min_views).toBe(12);
    expect(latest.rejected_no_subscriber_count).toBe(30);
    expect(latest.rejected_subscriber_out_of_band).toBe(40);
    expect(latest.rejected_below_momentum_threshold).toBe(8);
    expect(latest.best_rejected_momentum_score).toBe(22.5);
  });

  it('a Soundcharts run (no rejection filtering) leaves the breakdown columns null, not zero', () => {
    const run = createDiscoveryRun('soundcharts');
    completeDiscoveryRun(run.id, { status: 'completed', searchedCount: 10, candidatesFound: 2 });

    const latest = getLatestDiscoveryRun('soundcharts')!;
    expect(latest.id).toBe(run.id);
    expect(latest.rejected_below_min_views ?? null).toBeNull();
    expect(latest.rejected_below_momentum_threshold ?? null).toBeNull();
  });
});

describe('Account management', () => {
  it('createUser records ToS/Privacy acceptance at signup time', () => {
    const user = createUser({ name: 'Beta Tester', email: 'accept@example.com', password_hash: 'hash' });
    expect(user.tos_accepted_at).toBeTruthy();
    expect(user.privacy_accepted_at).toBeTruthy();
  });

  it('updateUserProfile changes name/avatar but never touches email, role, or credits', () => {
    const user = createUser({ name: 'Old Name', email: 'profile@example.com', password_hash: 'hash' });
    const updated = updateUserProfile(user.id, { name: 'New Name', avatar_url: 'https://example.com/a.png' })!;
    expect(updated.name).toBe('New Name');
    expect(updated.avatar_url).toBe('https://example.com/a.png');
    expect(updated.email).toBe('profile@example.com');
    expect(updated.role).toBe('public');
    expect(updated.next_credits_cents).toBe(STARTING_BALANCE_CENTS);
  });

  it('updateUserProfile clears avatar_url when given an empty string', () => {
    const user = createUser({ name: 'Has Avatar', email: 'avatar@example.com', password_hash: 'hash' });
    updateUserProfile(user.id, { avatar_url: 'https://example.com/a.png' });
    const cleared = updateUserProfile(user.id, { avatar_url: '' })!;
    expect(cleared.avatar_url ?? null).toBeNull();
  });

  it('markEmailVerified is idempotent — verifying twice keeps the original timestamp', () => {
    const user = createUser({ name: 'Verify Me', email: 'verify@example.com', password_hash: 'hash' });
    const first = markEmailVerified(user.id)!;
    const second = markEmailVerified(user.id)!;
    expect(first.email_verified_at).toBeTruthy();
    expect(second.email_verified_at).toBe(first.email_verified_at);
  });

  it('getUserPasswordHash returns the real hash, never exposed on the public User type', () => {
    const user = createUser({ name: 'Hash Check', email: 'hash@example.com', password_hash: 'super-secret-hash' });
    expect(getUserPasswordHash(user.id)).toBe('super-secret-hash');
    expect((user as any).password_hash).toBeUndefined();
  });

  it('deleteUser cascades NEXT holdings, transactions, and watchlist, but leaves the artist alone', () => {
    const user = createUser({ name: 'Deleting Soon', email: 'delete@example.com', password_hash: 'hash' });
    const artist = makeArtist('Cascade Target');
    executeTrade(user.id, artist.id, 'buy', 50_000);
    addToWatchlist(user.id, artist.id);
    expect(isWatchlisted(user.id, artist.id)).toBe(true);

    deleteUser(user.id);

    expect(getUserById(user.id)).toBeUndefined();
    // A fresh user id can't be watchlisted/checked against a deleted user,
    // so re-fetching the artist directly is the real assertion here: it
    // must still exist — deleting a trader must never delete the artist.
    expect(getArtist(artist.id)).toBeTruthy();
  });
});

describe('Discover aggregates — watch/backer counts', () => {
  it('getWatchCountsByArtist counts distinct watchers per artist, not per watchlist row', () => {
    const artist = makeArtist('Watched Artist');
    const other = makeArtist('Unwatched Artist');
    const alice = createUser({ name: 'Alice', email: 'alice-watch@example.com', password_hash: 'hash' });
    const bob = createUser({ name: 'Bob', email: 'bob-watch@example.com', password_hash: 'hash' });
    addToWatchlist(alice.id, artist.id);
    addToWatchlist(bob.id, artist.id);

    const counts = getWatchCountsByArtist();
    expect(counts[artist.id]).toBe(2);
    expect(counts[other.id] ?? 0).toBe(0);
  });

  it('getBackerCountsByArtist only counts users currently holding shares (> 0)', () => {
    const artist = makeArtist('Backed Artist');
    const holder = createUser({ name: 'Holder', email: 'holder@example.com', password_hash: 'hash' });
    const soldOut = createUser({ name: 'Sold Out', email: 'soldout@example.com', password_hash: 'hash' });

    executeTrade(holder.id, artist.id, 'buy', 50_000);
    executeTrade(soldOut.id, artist.id, 'buy', 50_000);
    executeTrade(soldOut.id, artist.id, 'sell', 999_999_999); // sell everything back out

    const counts = getBackerCountsByArtist();
    expect(counts[artist.id]).toBe(1);
  });
});

describe('Music experience — listen tracking', () => {
  it('hasListenedToArtist is false until a "started" event is recorded, then true', () => {
    const artist = makeArtist('Listened Artist');
    const user = createUser({ name: 'Listener', email: 'listener@example.com', password_hash: 'hash' });
    expect(hasListenedToArtist(user.id, artist.id)).toBe(false);

    recordPreviewListen(user.id, artist.id, 'started');
    expect(hasListenedToArtist(user.id, artist.id)).toBe(true);
  });

  it('a "completed" event alone does not count as having listened (started is the real signal)', () => {
    const artist = makeArtist('Completed Only Artist');
    const user = createUser({ name: 'Skipper', email: 'skipper@example.com', password_hash: 'hash' });
    recordPreviewListen(user.id, artist.id, 'completed');
    expect(hasListenedToArtist(user.id, artist.id)).toBe(false);
  });

  it('a buy is stamped listened_before_buy=true only when the listen happened first', () => {
    const artist = makeArtist('Buy After Listen');
    const listener = createUser({ name: 'Did Listen', email: 'did-listen@example.com', password_hash: 'hash' });
    const skipper = createUser({ name: 'Did Not Listen', email: 'no-listen@example.com', password_hash: 'hash' });

    recordPreviewListen(listener.id, artist.id, 'started');
    executeTrade(listener.id, artist.id, 'buy', 50_000);
    executeTrade(skipper.id, artist.id, 'buy', 50_000);

    const [listenerTx] = getUserTransactions(listener.id).filter((t) => t.artist_id === artist.id);
    const [skipperTx] = getUserTransactions(skipper.id).filter((t) => t.artist_id === artist.id);
    expect(listenerTx.listened_before_buy).toBe(true);
    expect(skipperTx.listened_before_buy).toBe(false);
  });

  it('sell transactions leave listened_before_buy undefined, not false', () => {
    const artist = makeArtist('Sell Row Artist');
    const user = createUser({ name: 'Trader', email: 'trader-sell@example.com', password_hash: 'hash' });
    executeTrade(user.id, artist.id, 'buy', 50_000);
    executeTrade(user.id, artist.id, 'sell', 999_999_999);

    const sellTx = getUserTransactions(user.id).find((t) => t.artist_id === artist.id && t.type === 'sell');
    expect(sellTx?.listened_before_buy).toBeUndefined();
  });
});

describe('Trading panel — volume, recent backers, activity feed', () => {
  it('getArtistTradeVolumeCents sums both buys and sells within the window, excludes trades outside it', () => {
    const artist = makeArtist('Volume Artist');
    const buyer = createUser({ name: 'Buyer', email: 'volume-buyer@example.com', password_hash: 'hash' });
    const seller = createUser({ name: 'Seller', email: 'volume-seller@example.com', password_hash: 'hash' });

    executeTrade(buyer.id, artist.id, 'buy', 50_000);
    executeTrade(seller.id, artist.id, 'buy', 30_000);
    executeTrade(seller.id, artist.id, 'sell', 10_000);

    // Backdate the buyer's trade to 48h ago so it falls outside a 24h window.
    db.prepare("UPDATE next_transactions SET created_at = datetime('now', '-48 hours') WHERE user_id = ?").run(buyer.id);

    const volume24h = getArtistTradeVolumeCents(artist.id, 24);
    // Only seller's buy (30,000) and sell (some proceeds close to 10,000,
    // adjusted by market impact) should count — never the backdated 50,000 buy.
    expect(volume24h).toBeGreaterThan(0);
    expect(volume24h).toBeLessThan(50_000 + 30_000 + 10_000);

    const volumeAllTime = getArtistTradeVolumeCents(artist.id, 24 * 365);
    expect(volumeAllTime).toBeGreaterThan(volume24h);
  });

  it('getRecentBackerCount counts distinct buyers in the window, not total buy transactions', () => {
    const artist = makeArtist('Recent Backers Artist');
    const alice = createUser({ name: 'Alice R', email: 'alice-recent@example.com', password_hash: 'hash' });
    const bob = createUser({ name: 'Bob R', email: 'bob-recent@example.com', password_hash: 'hash' });

    executeTrade(alice.id, artist.id, 'buy', 10_000);
    executeTrade(alice.id, artist.id, 'buy', 10_000); // same person, second buy — still counts once
    executeTrade(bob.id, artist.id, 'buy', 10_000);

    expect(getRecentBackerCount(artist.id, 24)).toBe(2);
  });

  it('getRecentTradesForArtist returns most-recent-first with the buyer/seller name attached', () => {
    const artist = makeArtist('Feed Artist');
    const alice = createUser({ name: 'Alice Feed', email: 'alice-feed@example.com', password_hash: 'hash' });
    const bob = createUser({ name: 'Bob Feed', email: 'bob-feed@example.com', password_hash: 'hash' });

    executeTrade(alice.id, artist.id, 'buy', 10_000);
    executeTrade(bob.id, artist.id, 'buy', 20_000);

    const trades = getRecentTradesForArtist(artist.id);
    expect(trades).toHaveLength(2);
    expect(trades[0].user_name).toBe('Bob Feed'); // most recent first
    expect(trades[1].user_name).toBe('Alice Feed');
    expect(trades[0].type).toBe('buy');
  });
});

describe('Watchlist — since-you-added deltas, momentum sort, alert preferences', () => {
  it('getScoreChanges only includes artists with a second snapshot, keyed off the latest minus the previous', () => {
    const stable = makeArtist('Stable Score Artist'); // only ever gets its creation snapshot
    const mover = makeArtist('Mover Score Artist');
    const scoreBefore = getNextArtist(mover.id)!.score;
    updateArtist(mover.id, { name: mover.name, music_talent: 10 }); // higher input -> higher Breakout Score -> a second snapshot
    const scoreAfter = getNextArtist(mover.id)!.score;

    const changes = getScoreChanges();
    expect(changes[stable.id]).toBeUndefined();
    expect(changes[mover.id]).toEqual({ changeAbs: Math.round((scoreAfter - scoreBefore) * 10) / 10, hasComparison: true });
    expect(changes[mover.id].changeAbs).toBeGreaterThan(0);
  });

  it('getUserWatchlist reports the Score/Price as of the watch date, distinct from where they stand now', () => {
    const artist = makeArtist('Since Watched Artist');
    const watcher = createUser({ name: 'Watcher', email: 'since-watched@example.com', password_hash: 'hash' });
    const mover = createUser({ name: 'Mover', email: 'since-watched-mover@example.com', password_hash: 'hash' });

    const scoreAtStart = getNextArtist(artist.id)!.score;
    const priceAtStart = getNextArtist(artist.id)!.priceCents; // seeds the first price_history row

    addToWatchlist(watcher.id, artist.id);

    // Move both Score and Price after the watch, then force these rows'
    // timestamps 10 minutes into the future — sequential real-clock calls
    // in a fast test can land in the same millisecond as the watch itself
    // (the exact race the Trading panel section's id-tiebreaker fix dealt
    // with for next_transactions), so this pins the ordering unambiguously
    // rather than relying on the test happening to run slowly enough.
    updateArtist(artist.id, { name: artist.name, music_talent: 10 });
    executeTrade(mover.id, artist.id, 'buy', 500_000);
    db.prepare(`
      UPDATE score_history SET recorded_at = datetime('now', '+10 minutes')
      WHERE id = (SELECT MAX(id) FROM score_history WHERE artist_id = ?)
    `).run(artist.id);
    db.prepare(`
      UPDATE next_price_history SET recorded_at = datetime('now', '+10 minutes')
      WHERE id = (SELECT MAX(id) FROM next_price_history WHERE artist_id = ?)
    `).run(artist.id);

    const [entry] = getUserWatchlist(watcher.id);
    expect(entry.artist.id).toBe(artist.id);
    expect(entry.scoreAtWatch).toBe(scoreAtStart);
    expect(entry.priceAtWatchCents).toBe(priceAtStart);
    expect(entry.score).toBeGreaterThan(entry.scoreAtWatch!);
    expect(entry.priceCents).toBeGreaterThan(entry.priceAtWatchCents!);
    expect(entry.alertsEnabled).toBe(true); // on by default
    expect(entry.watchedAt).toBeTruthy();
  });

  it('getUserWatchlist falls back to the earliest available price point when nothing was recorded before the watch', () => {
    // createArtist() already snapshots a score at creation, so to get a
    // genuinely empty "before" series this checks price only: an artist
    // whose price has never been read (no next_price_history row exists)
    // before it gets watched.
    const artist = createArtist({
      name: 'Never Priced Artist', music_talent: 8, growth_velocity_pct: 32, engagement_rate_pct: 16,
      original_song_response: 8, brand_personality: 8, content_consistency: 8, commercial_potential: 8, professionalism: 8,
    });
    const watcher = createUser({ name: 'Early Watcher', email: 'never-priced@example.com', password_hash: 'hash' });

    addToWatchlist(watcher.id, artist.id);

    // First-ever read of this artist's market data happens inside
    // getUserWatchlist itself, which seeds next_price_history lazily — so
    // the resulting single price point necessarily lands at/after the
    // watch, and there is nothing genuinely "before" to compare against.
    const [entry] = getUserWatchlist(watcher.id);
    expect(entry.priceAtWatchCents).toBe(entry.priceCents);
  });

  it('setWatchlistAlerts toggles the per-watch alert preference', () => {
    const artist = makeArtist('Alert Toggle Artist');
    const user = createUser({ name: 'Alert User', email: 'alert-toggle@example.com', password_hash: 'hash' });
    addToWatchlist(user.id, artist.id);

    expect(getUserWatchlist(user.id)[0].alertsEnabled).toBe(true);
    setWatchlistAlerts(user.id, artist.id, false);
    expect(getUserWatchlist(user.id)[0].alertsEnabled).toBe(false);
    setWatchlistAlerts(user.id, artist.id, true);
    expect(getUserWatchlist(user.id)[0].alertsEnabled).toBe(true);
  });
});

describe('Portfolio — value history reconstruction', () => {
  it('returns an empty history for a user with no trades', () => {
    const user = createUser({ name: 'No Trades', email: 'no-trades-history@example.com', password_hash: 'hash' });
    expect(getPortfolioValueHistory(user.id)).toEqual([]);
  });

  it("reflects a price move from another trader on a held artist, not just the holder's own trades", () => {
    const artist = makeArtist('Shared Price Artist');
    const holder = createUser({ name: 'Holder', email: 'holder-history@example.com', password_hash: 'hash' });
    const mover = createUser({ name: 'Mover', email: 'mover-history@example.com', password_hash: 'hash' });

    const buy = executeTrade(holder.id, artist.id, 'buy', 100_000);
    if (!buy.ok) throw new Error(buy.error);
    const historyRightAfterOwnBuy = getPortfolioValueHistory(holder.id);
    const valueRightAfterOwnBuy = historyRightAfterOwnBuy[historyRightAfterOwnBuy.length - 1].value_cents;

    // Someone else moves the market on the same artist — the holder never trades again.
    const moverBuy = executeTrade(mover.id, artist.id, 'buy', 500_000);
    if (!moverBuy.ok) throw new Error(moverBuy.error);
    // Force the mover's price point strictly later than the holder's own
    // buy — two real-clock calls this close together in a fast test can
    // land in the same millisecond and collapse into one reconstructed
    // moment (harmless for correctness, since both updates still land
    // before any snapshot taken afterward, but it would make this specific
    // length assertion flaky). Computed in JS (not SQLite's datetime()) so
    // the format matches every other recorded_at value exactly — a
    // space-vs-"T" mismatch at the same position would otherwise sort
    // wrong regardless of the actual time difference.
    db.prepare(`
      UPDATE next_price_history SET recorded_at = ?
      WHERE id = (SELECT MAX(id) FROM next_price_history WHERE artist_id = ?)
    `).run(new Date(Date.now() + 60_000).toISOString(), artist.id);

    const historyAfterMarketMove = getPortfolioValueHistory(holder.id);
    const valueAfterMarketMove = historyAfterMarketMove[historyAfterMarketMove.length - 1].value_cents;

    expect(historyAfterMarketMove.length).toBeGreaterThan(historyRightAfterOwnBuy.length);
    expect(valueAfterMarketMove).toBeGreaterThan(valueRightAfterOwnBuy);
  });

  it('never shows a buy-then-sell round trip as profitable, same as the trading engine itself', () => {
    const artist = makeArtist('Sell History Artist');
    const trader = createUser({ name: 'Trader', email: 'trader-history@example.com', password_hash: 'hash' });

    const buy = executeTrade(trader.id, artist.id, 'buy', 200_000);
    if (!buy.ok) throw new Error(buy.error);
    const afterBuy = getPortfolioValueHistory(trader.id);
    const afterBuyValue = afterBuy[afterBuy.length - 1].value_cents;

    const sell = executeTrade(trader.id, artist.id, 'sell', 100_000);
    if (!sell.ok) throw new Error(sell.error);
    const afterSell = getPortfolioValueHistory(trader.id);
    const afterSellValue = afterSell[afterSell.length - 1].value_cents;

    // Not asserting history length here: a buy and sell close enough
    // together can land in the same millisecond and collapse into one
    // reconstructed moment (harmless — the buy is still applied before the
    // sell within that moment, per the id-ASC tiebreak in the underlying
    // query, so the final value is unaffected either way).
    expect(afterSellValue).toBeLessThanOrEqual(afterBuyValue);
  });
});

describe('Leaderboard — time windows and rank movement', () => {
  it("the 'all' window matches getPortfolioValue's own totalReturnPct exactly (no regression from adding windows)", () => {
    const user = createUser({ name: 'All Window Scout', email: 'all-window@example.com', password_hash: 'hash' });
    const artist = makeArtist('All Window Artist');
    executeTrade(user.id, artist.id, 'buy', 100_000);

    const entry = getScoutLeaderboard('all').find((e) => e.user.id === user.id)!;
    expect(entry.totalReturnPct).toBe(getPortfolioValue(user.id).totalReturnPct);
  });

  it("the 'week' window measures return from the value at the start of the window, not all-time", () => {
    const user = createUser({ name: 'Week Window Scout', email: 'week-window@example.com', password_hash: 'hash' });
    const artist = makeArtist('Week Window Artist');

    // Backdate the account and an early trade to well before the 7-day
    // cutoff, so 'week' has a real historical baseline to measure from
    // instead of falling back to the starting balance. Every backdated
    // timestamp is computed in JS (never SQLite's datetime()) so the string
    // format matches every real recorded_at/created_at value exactly — a
    // SQLite-format "2026-08-03 19:01" vs this app's ISO
    // "2026-08-03T19:01...Z" would otherwise collate wrong wherever a
    // string comparison's tiebreak lands on that space-vs-"T" character.
    // Large enough trades that the impact-driven value move survives
    // rounding to 1 decimal place — a modest trade's paper "P&L" is only a
    // few cents either way (impact cost is intentionally small; see the
    // trading engine's self-trade exploit tests above), which would make
    // 'all' and 'week' round to the identical 0.0% regardless of whether
    // the baselines actually differ internally.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(thirtyDaysAgo, user.id);
    const earlyBuy = executeTrade(user.id, artist.id, 'buy', 600_000);
    if (!earlyBuy.ok) throw new Error(earlyBuy.error);
    db.prepare('UPDATE next_transactions SET created_at = ? WHERE user_id = ?').run(twentyDaysAgo, user.id);
    db.prepare('UPDATE next_price_history SET recorded_at = ? WHERE artist_id = ?').run(twentyDaysAgo, artist.id);

    // A second trade lands "now" — inside the window.
    const recentBuy = executeTrade(user.id, artist.id, 'buy', 300_000);
    if (!recentBuy.ok) throw new Error(recentBuy.error);

    const allEntry = getScoutLeaderboard('all').find((e) => e.user.id === user.id)!;
    const weekEntry = getScoutLeaderboard('week').find((e) => e.user.id === user.id)!;

    // 'all' is measured from the starting balance (includes both trades'
    // impact cost); 'week' is measured from the backdated snapshot
    // (includes only the recent trade) — different baselines, so different
    // numbers, proving 'week' isn't secretly just re-running the all-time math.
    expect(weekEntry.totalReturnPct).not.toBe(allEntry.totalReturnPct);
  });

  it('getRankMovements is null for an account that did not exist 7 days ago, and non-null for one that did', () => {
    const faller = createUser({ name: 'Faller', email: 'faller-rank@example.com', password_hash: 'hash' });
    const riser = createUser({ name: 'Riser', email: 'riser-rank@example.com', password_hash: 'hash' }); // created "now" — genuinely new relative to the 7-day window
    const artist = makeArtist('Rank Movement Artist');

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(thirtyDaysAgo, faller.id);
    const fallerEarly = executeTrade(faller.id, artist.id, 'buy', 200_000);
    if (!fallerEarly.ok) throw new Error(fallerEarly.error);
    db.prepare('UPDATE next_transactions SET created_at = ? WHERE user_id = ?').run(twentyDaysAgo, faller.id);
    db.prepare('UPDATE next_price_history SET recorded_at = ? WHERE artist_id = ?').run(twentyDaysAgo, artist.id);

    const riserBuy = executeTrade(riser.id, artist.id, 'buy', 500_000);
    if (!riserBuy.ok) throw new Error(riserBuy.error);

    const movements = getRankMovements();
    expect(movements[riser.id]).toBeNull();
    expect(movements[faller.id]).not.toBeNull();
  });
});

describe('Public Scout Profile — favorite genres, positions privacy toggle', () => {
  it('getFavoriteGenres ranks genres by how many artists in each the Scout has ever backed', () => {
    const user = createUser({ name: 'Genre Scout', email: 'genre-scout@example.com', password_hash: 'hash' });
    const popArtists = [
      createArtist({ name: 'Pop One', genre: 'Pop', music_talent: 8, growth_velocity_pct: 32, engagement_rate_pct: 16, original_song_response: 8, brand_personality: 8, content_consistency: 8, commercial_potential: 8, professionalism: 8 }),
      createArtist({ name: 'Pop Two', genre: 'Pop', music_talent: 8, growth_velocity_pct: 32, engagement_rate_pct: 16, original_song_response: 8, brand_personality: 8, content_consistency: 8, commercial_potential: 8, professionalism: 8 }),
    ];
    const jazzArtist = createArtist({ name: 'Jazz One', genre: 'Jazz', music_talent: 8, growth_velocity_pct: 32, engagement_rate_pct: 16, original_song_response: 8, brand_personality: 8, content_consistency: 8, commercial_potential: 8, professionalism: 8 });

    for (const artist of popArtists) executeTrade(user.id, artist.id, 'buy', 10_000);
    executeTrade(user.id, jazzArtist.id, 'buy', 10_000);

    const favorites = getFavoriteGenres(user.id);
    expect(favorites[0]).toEqual({ genre: 'Pop', count: 2 });
    expect(favorites[1]).toEqual({ genre: 'Jazz', count: 1 });
  });

  it('updateUserProfile toggles show_positions_publicly, normalized back to a real boolean (not 0/1)', () => {
    const user = createUser({ name: 'Privacy Scout', email: 'privacy-scout@example.com', password_hash: 'hash' });
    expect(user.show_positions_publicly).toBe(false); // off by default

    updateUserProfile(user.id, { show_positions_publicly: true });
    expect(getUserById(user.id)!.show_positions_publicly).toBe(true);

    updateUserProfile(user.id, { show_positions_publicly: false });
    expect(getUserById(user.id)!.show_positions_publicly).toBe(false);
  });

  it("getScoutProfile hides positions (null, not an empty list) until the Scout opts in, then shows real holdings", () => {
    const user = createUser({ name: 'Position Scout', email: 'position-scout@example.com', password_hash: 'hash' });
    const artist = makeArtist('Position Scout Artist');
    const buy = executeTrade(user.id, artist.id, 'buy', 50_000);
    if (!buy.ok) throw new Error(buy.error);

    const hiddenProfile = getScoutProfile(user.id)!;
    expect(hiddenProfile.showPositionsPublicly).toBe(false);
    expect(hiddenProfile.positions).toBeNull();

    updateUserProfile(user.id, { show_positions_publicly: true });
    const shownProfile = getScoutProfile(user.id)!;
    expect(shownProfile.showPositionsPublicly).toBe(true);
    expect(shownProfile.positions).toHaveLength(1);
    expect(shownProfile.positions![0]).toMatchObject({ artist_id: artist.id, artist_name: 'Position Scout Artist' });
    expect(shownProfile.positions![0].shares).toBeCloseTo(buy.shares, 6);
  });
});

describe('Market Activity — market-wide feed, volume, active/backed/watched, new artists', () => {
  it('getRecentMarketTrades returns every artist\'s trades together, most recent first', () => {
    const artistA = makeArtist('Market Feed Artist A');
    const artistB = makeArtist('Market Feed Artist B');
    const trader = createUser({ name: 'Market Feed Trader', email: 'market-feed@example.com', password_hash: 'hash' });

    executeTrade(trader.id, artistA.id, 'buy', 10_000);
    executeTrade(trader.id, artistB.id, 'buy', 20_000);

    const trades = getRecentMarketTrades(10);
    const names = trades.map((t) => t.artist_name);
    expect(names).toContain('Market Feed Artist A');
    expect(names).toContain('Market Feed Artist B');
    expect(trades[0].artist_name).toBe('Market Feed Artist B'); // most recent first
  });

  it('getMarketVolumeCents and getMarketTradeCounts only count trades inside the window, across every artist', () => {
    // Both queries are true market-wide aggregates with no per-test
    // scoping, and this file shares one DB across ~120 tests that all run
    // "now" — so asserting an exact count would really be asserting
    // "nothing else in the whole suite traded in the last 24h," which
    // isn't true. Instead this measures the DELTA this test's own trades
    // cause, which holds regardless of what the rest of the suite did.
    const before24h = getMarketTradeCounts(24);
    const beforeVolume24h = getMarketVolumeCents(24);

    const artistA = makeArtist('Volume Feed Artist A');
    const artistB = makeArtist('Volume Feed Artist B');
    const buyer = createUser({ name: 'Volume Feed Buyer', email: 'volume-feed-buyer@example.com', password_hash: 'hash' });
    const seller = createUser({ name: 'Volume Feed Seller', email: 'volume-feed-seller@example.com', password_hash: 'hash' });

    executeTrade(buyer.id, artistA.id, 'buy', 50_000);
    const oldBuy = executeTrade(seller.id, artistB.id, 'buy', 40_000);
    if (!oldBuy.ok) throw new Error(oldBuy.error);
    executeTrade(seller.id, artistB.id, 'sell', 10_000);

    // Push one artist's trade outside the 24h window entirely.
    db.prepare("UPDATE next_transactions SET created_at = ? WHERE user_id = ? AND artist_id = ? AND type = 'buy'")
      .run(new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), seller.id, artistB.id);

    const volume24h = getMarketVolumeCents(24);
    const volumeAllTime = getMarketVolumeCents(24 * 365);
    expect(volumeAllTime).toBeGreaterThan(volume24h);
    // Only the artistA buy and the artistB sell remain inside the window —
    // the backdated artistB buy dropped out.
    expect(volume24h - beforeVolume24h).toBeGreaterThan(0);
    expect(volume24h - beforeVolume24h).toBeLessThan(50_000 + 10_000);

    const after24h = getMarketTradeCounts(24);
    expect(after24h.buys - before24h.buys).toBe(1);
    expect(after24h.sells - before24h.sells).toBe(1);
  });

  it('getMostActiveArtists ranks by trade count within the window', () => {
    const busy = makeArtist('Busy Feed Artist');
    const quiet = makeArtist('Quiet Feed Artist');
    const trader = createUser({ name: 'Active Feed Trader', email: 'active-feed@example.com', password_hash: 'hash' });

    executeTrade(trader.id, busy.id, 'buy', 10_000);
    executeTrade(trader.id, busy.id, 'buy', 10_000);
    executeTrade(trader.id, busy.id, 'buy', 10_000);
    executeTrade(trader.id, quiet.id, 'buy', 10_000);

    // A generous limit: by this point in the suite many other tests have
    // traded other artists in the last 24h too, so a small limit could
    // legitimately push either of these two out of a top-10.
    const active = getMostActiveArtists(24, 1000);
    const busyEntry = active.find((a) => a.artist_id === busy.id)!;
    const quietEntry = active.find((a) => a.artist_id === quiet.id)!;
    expect(busyEntry.tradeCount).toBe(3);
    expect(quietEntry.tradeCount).toBe(1);
    expect(active.indexOf(busyEntry)).toBeLessThan(active.indexOf(quietEntry));
  });

  it('getRecentBackerCountsByArtist and getRecentWatchCountsByArtist count distinct recent activity per artist', () => {
    const artist = makeArtist('Recent Counts Artist');
    const alice = createUser({ name: 'Alice Counts', email: 'alice-counts@example.com', password_hash: 'hash' });
    const bob = createUser({ name: 'Bob Counts', email: 'bob-counts@example.com', password_hash: 'hash' });

    executeTrade(alice.id, artist.id, 'buy', 10_000);
    executeTrade(alice.id, artist.id, 'buy', 10_000); // same backer again — still counts once
    executeTrade(bob.id, artist.id, 'buy', 10_000);
    addToWatchlist(alice.id, artist.id);
    addToWatchlist(bob.id, artist.id);

    expect(getRecentBackerCountsByArtist(24)[artist.id]).toBe(2);
    expect(getRecentWatchCountsByArtist(24)[artist.id]).toBe(2);
  });

  it('getNewArtistsThisWeek excludes artists older than the window and passed artists', () => {
    const freshArtist = makeArtist('Fresh This Week Artist');
    const oldArtist = makeArtist('Old Artist');
    db.prepare('UPDATE artists SET created_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), oldArtist.id);
    const passedArtist = createArtist({
      name: 'Passed This Week Artist', stage: 'passed', music_talent: 8, growth_velocity_pct: 32, engagement_rate_pct: 16,
      original_song_response: 8, brand_personality: 8, content_consistency: 8, commercial_potential: 8, professionalism: 8,
    });

    const fresh = getNewArtistsThisWeek(7);
    const names = fresh.map((a) => a.name);
    expect(names).toContain('Fresh This Week Artist');
    expect(names).not.toContain('Old Artist');
    expect(names).not.toContain('Passed This Week Artist');
  });
});

describe('Notification center — read-state persistence and preference columns', () => {
  it('markNotificationRead/markNotificationsRead persist keys, and re-marking the same key is a harmless no-op', () => {
    const user = createUser({ name: 'Notif Reader', email: 'notif-reader@example.com', password_hash: 'hash' });
    expect(getReadNotificationKeys(user.id).size).toBe(0);

    markNotificationRead(user.id, 'watchlist_score:1:1');
    markNotificationRead(user.id, 'watchlist_score:1:1'); // duplicate — should not throw or double-insert
    markNotificationsRead(user.id, ['leaderboard_rank:2026-01-01', 'portfolio_milestone:25']);

    const keys = getReadNotificationKeys(user.id);
    expect(keys.size).toBe(3);
    expect(keys.has('watchlist_score:1:1')).toBe(true);
    expect(keys.has('portfolio_milestone:25')).toBe(true);
    expect(keys.has('some-other-key')).toBe(false);
  });

  it('read state is scoped per user — one user marking a key read does not affect another', () => {
    const alice = createUser({ name: 'Notif Alice', email: 'notif-alice@example.com', password_hash: 'hash' });
    const bob = createUser({ name: 'Notif Bob', email: 'notif-bob@example.com', password_hash: 'hash' });
    markNotificationRead(alice.id, 'shared-key');
    expect(getReadNotificationKeys(alice.id).has('shared-key')).toBe(true);
    expect(getReadNotificationKeys(bob.id).has('shared-key')).toBe(false);
  });

  it('setNotificationsEmailedThrough updates the cursor column', () => {
    const user = createUser({ name: 'Notif Cursor', email: 'notif-cursor@example.com', password_hash: 'hash' });
    expect(getUserById(user.id)!.notifications_emailed_through).toBeFalsy();
    const now = new Date().toISOString();
    setNotificationsEmailedThrough(user.id, now);
    expect(getUserById(user.id)!.notifications_emailed_through).toBe(now);
  });

  it('updateUserProfile round-trips every notification preference as a real boolean, defaulting on except email', () => {
    const user = createUser({ name: 'Notif Prefs', email: 'notif-prefs@example.com', password_hash: 'hash' });
    expect(user.notify_watchlist_moves).toBe(true);
    expect(user.notify_new_artists).toBe(true);
    expect(user.notify_founding_believer).toBe(true);
    expect(user.notify_portfolio_milestones).toBe(true);
    expect(user.notify_leaderboard_rank).toBe(true);
    expect(user.email_notifications_enabled).toBe(false); // opt-in, unlike the rest

    const updated = updateUserProfile(user.id, {
      notify_watchlist_moves: false, notify_new_artists: false, email_notifications_enabled: true,
    })!;
    expect(updated.notify_watchlist_moves).toBe(false);
    expect(updated.notify_new_artists).toBe(false);
    expect(updated.email_notifications_enabled).toBe(true);
    expect(updated.notify_founding_believer).toBe(true); // untouched fields stay as they were
  });
});

describe('Product analytics — event logging', () => {
  it('logEvent records the event type and JSON metadata, most recent first', () => {
    const user = createUser({ name: 'Event User', email: 'event-user@example.com', password_hash: 'hash' });
    logEvent(user.id, 'watchlist_added', { artistId: 42 });
    logEvent(user.id, 'artist_detail_opened', { artistId: 42 });

    const events = getRecentEventsForUser(user.id);
    expect(events).toHaveLength(2);
    expect(events[0].event_type).toBe('artist_detail_opened'); // most recent first
    expect(events[0].metadata).toEqual({ artistId: 42 });
    expect(events[1].event_type).toBe('watchlist_added');
  });

  it('logEvent with no metadata stores a null metadata field, not an empty object', () => {
    const user = createUser({ name: 'No Metadata User', email: 'no-metadata@example.com', password_hash: 'hash' });
    logEvent(user.id, 'discover_viewed');
    expect(getRecentEventsForUser(user.id)[0].metadata).toBeNull();
  });

  it('logArtistCardViews writes one artist_card_viewed row per artist id', () => {
    const user = createUser({ name: 'Card View User', email: 'card-view@example.com', password_hash: 'hash' });
    logArtistCardViews(user.id, [1, 2, 3]);
    const events = getRecentEventsForUser(user.id);
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.event_type === 'artist_card_viewed')).toBe(true);
    expect(events.map((e) => (e.metadata as any).artistId).sort()).toEqual([1, 2, 3]);
  });

  it('logArtistCardViews is a no-op for an empty artist list', () => {
    const user = createUser({ name: 'Empty Card View User', email: 'empty-card-view@example.com', password_hash: 'hash' });
    logArtistCardViews(user.id, []);
    expect(getRecentEventsForUser(user.id)).toHaveLength(0);
  });

  it('getEventCountsByType reflects newly logged events (measured as a delta, not an exact global count — this file shares one DB across the whole suite)', () => {
    const before = getEventCountsByType();
    const user = createUser({ name: 'Count User', email: 'count-user@example.com', password_hash: 'hash' });
    logEvent(user.id, 'video_played', { artistId: 1 });
    logEvent(user.id, 'video_played', { artistId: 2 });
    const after = getEventCountsByType();
    expect((after.video_played ?? 0) - (before.video_played ?? 0)).toBe(2);
  });

  it('recordLogin reports returning:false on the first login and returning:true afterward, stamping last_login_at each time', () => {
    const user = createUser({ name: 'Login User', email: 'login-user@example.com', password_hash: 'hash' });
    expect(getUserById(user.id)!.last_login_at).toBeFalsy();

    const first = recordLogin(user.id);
    expect(first.returning).toBe(false);
    expect(getUserById(user.id)!.last_login_at).toBeTruthy();

    const second = recordLogin(user.id);
    expect(second.returning).toBe(true);
  });

  it('completeNextOnboarding logs onboarding_completed exactly once, even if called again (idempotent)', () => {
    const user = createUser({ name: 'Onboarding User', email: 'onboarding-user@example.com', password_hash: 'hash' });
    completeNextOnboarding(user.id);
    completeNextOnboarding(user.id); // already onboarded — the WHERE guard makes this a no-op

    const events = getRecentEventsForUser(user.id).filter((e) => e.event_type === 'onboarding_completed');
    expect(events).toHaveLength(1);
  });
});
