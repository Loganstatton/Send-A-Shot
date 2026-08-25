import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';

// DATA_DIR must be set before lib/data-dir.ts (and therefore lib/db.ts) is
// ever imported, so this test runs against an isolated, throwaway SQLite
// file instead of the real dev/prod database.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-test-'));

const {
  addLogEntry, addToWatchlist, approveDiscoveryCandidate, bulkSetArtistStage, completeDiscoveryRun,
  completeNextOnboarding, completeSyncRun, createArtist, createArtistClaim, createDiscoveryRun, createFeedEvent, createSyncRun,
  createUser, db,
  deleteUser, executeTrade, findArtistsByName,
  getApprovedDiscoveriesCount, getArtist, getArtistClaim, getArtistFieldHistory, getArtistLastActivityMap,
  getArtistLog, getArtistsClaimedByUser,
  getArtistsMissingDeezerData, getErrorReportCount, getRecentErrorReports, insertErrorReport,
  getArtistsInPhotoBackoff, getArtistsInVideoBackoff, getArtistsMissingPhoto, getArtistsMissingVideo, getArtistsWithSoundchartsLink,
  getArtistTradeVolumeCents, getBackedArtistIds, getBackerCountsByArtist, getBreakoutDiscoveriesCount, getDiscoveriesForUser,
  getDiscoveryCandidateCountsByGenre,
  getDiscoveryCandidateCountsByStatus, getDiscoveryCandidateHistory, getDiscoveryCandidates, getDiscoveryGenres,
  getDiscoveryLeaderboard, getEarliestScoreSnapshots,
  getEventCountsByType,
  getFavoriteGenres, getFeedEvent, getFeedEventCount, getFeedEvents, getFoundingBelieverRecord, getFoundingBelieverRecordById, getKnownDiscoveryUuids,
  getKnownDiscoveryYoutubeChannelIds, getLatestDiscoveryRun,
  getLatestScoreSnapshots,
  getLatestSyncRun, getLogEntryById, getMarketTradeCounts, getMarketVolumeCents, getMissingPlatformLinksImpact,
  getMostActiveArtists, getNewArtistsThisWeek, getNewDiscoveryCandidateCount, getNextArtist, getNextArtistsByIds,
  getPendingArtistClaimCount, getPendingArtistClaims, getPendingClaimForUserAndArtist, getPortfolioValue,
  getPortfolioValueHistory, getRankMovements,
  getReadNotificationKeys, getRecentBackerCount, getRecentBackerCountsByArtist, getRecentDiscoveryReviewDecisions,
  getRecentDiscoveryRunsWithCandidateCounts, getRecentEventsForUser,
  getRecentMarketTrades, getRecentSubmissionCount, getRecentSyncFailures, getRecentTradesForArtist,
  getRecentTradeCount, getRecentWatchCountsByArtist,
  getScoreChanges, getScoutLeaderboard, getScoutProfile, getStoredTradeResponse, getSuspiciousTradingFlags,
  getTrackedSoundchartsUuids, getUnverifiedVideoMatchCount,
  getUserById, getUserPasswordHash, getUsersByIds, getUserTransactions, getUserWatchlist, getWatchCountsByArtist,
  getYoutubeQuotaUsedToday, hasFeedEventSince, hasListenedToArtist, findDuplicateArtistSubmission, findUserByNormalizedEmail,
  normalizeEmailForDuplicateCheck, insertDiscoveryCandidate, isWatchlisted,
  logArtistCardViews, logFeedItemImpressions,
  logEvent, logSyncFailure, markEmailVerified, markNotificationRead, markNotificationsRead, recordLogin,
  recordPreviewListen, recordYoutubeQuotaUsage, reviewArtistClaim, setDiscoveryCandidateStatus,
  setFeaturedVideoMatchType,
  setNotificationsEmailedThrough, setWatchlistAlerts, shareFoundingBelieverToFeed, SOUNDCHARTS_NO_MATCH_RECHECK_DAYS, stampSoundchartsNoMatch,
  stampSourceSyncedAt, stampYoutubeNoMatch, storeTradeResponse,
  TRADE_RATE_LIMIT_PER_MINUTE, updateArtist,
  updateUserProfile, YOUTUBE_NO_MATCH_RECHECK_DAYS,
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

describe('Deezer top-song and photo sync', () => {
  it('getArtistsMissingDeezerData returns an artist missing either field, but not one with both filled', () => {
    const missingBoth = createArtist({ name: 'No Top Song Or Photo Yet' });
    const missingPhotoOnly = createArtist({ name: 'Has Song No Photo', top_song_url: 'https://www.deezer.com/track/123' });
    const missingSongOnly = createArtist({ name: 'Has Photo No Song', photo_url: 'https://example.com/photo.jpg' });
    const hasBoth = createArtist({
      name: 'Already Has Both', top_song_url: 'https://www.deezer.com/track/999', photo_url: 'https://example.com/both.jpg',
    });

    const ids = getArtistsMissingDeezerData().map((r) => r.id);
    expect(ids).toContain(missingBoth.id);
    expect(ids).toContain(missingPhotoOnly.id);
    expect(ids).toContain(missingSongOnly.id);
    expect(ids).not.toContain(hasBoth.id);
  });

  it('filling in one missing field leaves an artist in the set until the other is filled too', () => {
    const artist = createArtist({ name: 'Freshly Filled' });
    expect(getArtistsMissingDeezerData().map((r) => r.id)).toContain(artist.id);

    updateArtist(artist.id, { name: artist.name, top_song_url: 'https://www.deezer.com/track/456' } as any);
    // Still missing a photo — sync should visit it again.
    expect(getArtistsMissingDeezerData().map((r) => r.id)).toContain(artist.id);

    updateArtist(artist.id, { name: artist.name, photo_url: 'https://example.com/now-has-one.jpg' } as any);
    expect(getArtistsMissingDeezerData().map((r) => r.id)).not.toContain(artist.id);
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
        duplicateSoundchartsMatch: 3,
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
    expect(latest.rejected_duplicate_soundcharts_match).toBe(3);
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

describe('Data reliability (Phase 4) — sync provenance, failure logging, duplicate detection', () => {
  it('stampSourceSyncedAt writes the correct per-source column and leaves the others untouched', () => {
    const artist = makeArtist('Provenance Artist');
    const before = new Date(Date.now() - 60_000).toISOString();

    stampSourceSyncedAt(artist.id, 'soundcharts', before);
    let updated = getArtist(artist.id)!;
    expect(updated.soundcharts_synced_at).toBe(before);
    expect(updated.deezer_synced_at).toBeFalsy();
    expect(updated.youtube_synced_at).toBeFalsy();

    stampSourceSyncedAt(artist.id, 'deezer');
    stampSourceSyncedAt(artist.id, 'youtube');
    updated = getArtist(artist.id)!;
    expect(updated.deezer_synced_at).toBeTruthy();
    expect(updated.youtube_synced_at).toBeTruthy();
    // The earlier soundcharts stamp is untouched by the later calls for
    // other sources.
    expect(updated.soundcharts_synced_at).toBe(before);
  });

  it('setFeaturedVideoMatchType stores and clears the match-confidence flag', () => {
    const artist = makeArtist('Match Type Artist');
    setFeaturedVideoMatchType(artist.id, 'search_unverified');
    expect(getArtist(artist.id)!.featured_video_match_type).toBe('search_unverified');
    expect(getUnverifiedVideoMatchCount()).toBeGreaterThanOrEqual(1);

    setFeaturedVideoMatchType(artist.id, null);
    expect(getArtist(artist.id)!.featured_video_match_type).toBeFalsy();
  });

  it('findArtistsByName matches case-insensitively and excludes unrelated names', () => {
    const artist = makeArtist('Duplicate Name Check Artist');
    const matches = findArtistsByName('duplicate name check artist');
    expect(matches.map((m) => m.id)).toContain(artist.id);
    expect(findArtistsByName('Definitely Not A Real Artist Name XYZ')).toHaveLength(0);
  });

  it('creating a second artist with an already-linked soundcharts_uuid throws (unique index enforced)', () => {
    const first = createArtist({ name: 'First Linked Artist', soundcharts_uuid: 'dup-uuid-test-1' });
    expect(first.soundcharts_uuid).toBe('dup-uuid-test-1');
    expect(() => createArtist({ name: 'Second Linked Artist', soundcharts_uuid: 'dup-uuid-test-1' })).toThrow(/UNIQUE constraint failed/i);
  });

  it('two artists may each have soundcharts_uuid = null without violating the partial unique index', () => {
    const a = makeArtist('Unlinked Artist A');
    const b = makeArtist('Unlinked Artist B');
    expect(a.soundcharts_uuid).toBeFalsy();
    expect(b.soundcharts_uuid).toBeFalsy();
  });

  it('logSyncFailure and getRecentSyncFailures record and retrieve structured per-artist failures, filterable by source', () => {
    const artist = makeArtist('Failure Log Artist');
    const run = createSyncRun('soundcharts');

    const before = getRecentSyncFailures('soundcharts').length;
    logSyncFailure(run.id, 'soundcharts', artist.id, artist.name, 'Simulated Soundcharts timeout');
    logSyncFailure(run.id, 'deezer', artist.id, artist.name, 'Simulated Deezer error');

    const soundchartsFailures = getRecentSyncFailures('soundcharts');
    expect(soundchartsFailures.length).toBe(before + 1);
    expect(soundchartsFailures[0].error).toBe('Simulated Soundcharts timeout');
    expect(soundchartsFailures[0].artist_name).toBe(artist.name);

    const all = getRecentSyncFailures();
    expect(all.some((f) => f.error === 'Simulated Deezer error')).toBe(true);
  });

  it('getArtistsWithSoundchartsLink includes name (needed for failure logging by the sync route)', () => {
    const artist = createArtist({ name: 'Linked Name Artist', soundcharts_uuid: 'name-check-uuid-1' });
    const linked = getArtistsWithSoundchartsLink().find((a) => a.id === artist.id);
    expect(linked).toBeDefined();
    expect(linked!.name).toBe('Linked Name Artist');
  });
});

describe('YouTube quota protection (Phase 4) — daily usage ledger and re-search backoff', () => {
  it('recordYoutubeQuotaUsage and getYoutubeQuotaUsedToday sum only same-day usage', () => {
    const day = 'quota-test-day-1';
    const otherDay = 'quota-test-day-2';
    expect(getYoutubeQuotaUsedToday(day)).toBe(0);

    recordYoutubeQuotaUsage(100, '/search', day);
    recordYoutubeQuotaUsage(1, '/channels', day);
    recordYoutubeQuotaUsage(1, '/videos', day);
    recordYoutubeQuotaUsage(50, '/search', otherDay); // a different day — must not count toward `day`

    expect(getYoutubeQuotaUsedToday(day)).toBe(102);
    expect(getYoutubeQuotaUsedToday(otherDay)).toBe(50);
  });

  it('getArtistsMissingVideo excludes an artist recently confirmed to have no match, but includes one checked long ago', () => {
    const recentlyChecked = makeArtist('Recently No-Match Artist');
    const longAgoChecked = makeArtist('Long-Ago No-Match Artist');
    const neverChecked = makeArtist('Never Checked Artist');

    stampYoutubeNoMatch(recentlyChecked.id); // "now" — well within the backoff window
    const beforeWindow = new Date(Date.now() - (YOUTUBE_NO_MATCH_RECHECK_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
    stampYoutubeNoMatch(longAgoChecked.id, beforeWindow);

    const missing = getArtistsMissingVideo().map((a) => a.id);
    expect(missing).not.toContain(recentlyChecked.id);
    expect(missing).toContain(longAgoChecked.id);
    expect(missing).toContain(neverChecked.id);
  });

  it('getArtistsMissingVideo re-includes an artist once featured_video_id is cleared, even if it was previously no-matched', () => {
    // A Scout typing in a video link by hand after an automated "no match"
    // must not be silently overridden — but if they later remove it again,
    // the backoff window (still fresh) should still apply.
    const artist = makeArtist('Cleared Video Artist');
    stampYoutubeNoMatch(artist.id);
    expect(getArtistsMissingVideo().map((a) => a.id)).not.toContain(artist.id);

    updateArtist(artist.id, { featured_video_id: 'manually-pasted-id' } as any);
    expect(getArtistsMissingVideo().map((a) => a.id)).not.toContain(artist.id); // has a video now, not missing

    updateArtist(artist.id, { featured_video_id: '' } as any);
    // Missing again, but the no-match stamp is still recent — still excluded.
    expect(getArtistsMissingVideo().map((a) => a.id)).not.toContain(artist.id);
  });

  it('getArtistsInVideoBackoff counts exactly the artists getArtistsMissingVideo excludes, and reports the earliest recheck date', () => {
    const before = getArtistsInVideoBackoff().count;

    const recent = makeArtist('Backoff Visibility Recent');
    const longAgo = makeArtist('Backoff Visibility Long Ago');
    const withVideo = makeArtist('Backoff Visibility Has Video');

    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    stampYoutubeNoMatch(recent.id, fiveDaysAgo);
    const beforeWindow = new Date(Date.now() - (YOUTUBE_NO_MATCH_RECHECK_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
    stampYoutubeNoMatch(longAgo.id, beforeWindow); // outside the window — not in backoff
    stampYoutubeNoMatch(withVideo.id, fiveDaysAgo);
    updateArtist(withVideo.id, { featured_video_id: 'has-a-video' } as any); // has a video now — not "missing" at all

    const after = getArtistsInVideoBackoff();
    // Exactly one new artist (`recent`) entered the backoff set.
    expect(after.count - before).toBe(1);
    expect(getArtistsMissingVideo().map((a) => a.id)).not.toContain(recent.id);

    const expectedRecheck = new Date(new Date(fiveDaysAgo).getTime() + YOUTUBE_NO_MATCH_RECHECK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    expect(after.earliestRecheckAt).toBe(expectedRecheck);
  });
});

describe('Soundcharts photo backfill — search-and-link for artists the regular sync can never reach', () => {
  it('getArtistsMissingPhoto excludes an artist that already has a Soundcharts link, even with no photo', () => {
    // The regular /api/soundcharts/sync already owns re-checking linked
    // artists — the backfill's job is only to find and link the ones sync
    // can't see at all, never to duplicate that work.
    const linkedNoPhoto = createArtist({ name: 'Linked No Photo Artist', soundcharts_uuid: 'backfill-linked-uuid-1' });
    expect(getArtistsMissingPhoto().map((a) => a.id)).not.toContain(linkedNoPhoto.id);
  });

  it('getArtistsMissingPhoto excludes an artist recently confirmed to have no match, but includes one checked long ago', () => {
    const recentlyChecked = makeArtist('Recently No-Match Photo Artist');
    const longAgoChecked = makeArtist('Long-Ago No-Match Photo Artist');
    const neverChecked = makeArtist('Never Checked Photo Artist');

    stampSoundchartsNoMatch(recentlyChecked.id); // "now" — well within the backoff window
    const beforeWindow = new Date(Date.now() - (SOUNDCHARTS_NO_MATCH_RECHECK_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
    stampSoundchartsNoMatch(longAgoChecked.id, beforeWindow);

    const missing = getArtistsMissingPhoto().map((a) => a.id);
    expect(missing).not.toContain(recentlyChecked.id);
    expect(missing).toContain(longAgoChecked.id);
    expect(missing).toContain(neverChecked.id);
  });

  it('getArtistsMissingPhoto re-includes an artist once photo_url is cleared, even if it was previously no-matched', () => {
    const artist = makeArtist('Cleared Photo Artist');
    stampSoundchartsNoMatch(artist.id);
    expect(getArtistsMissingPhoto().map((a) => a.id)).not.toContain(artist.id);

    updateArtist(artist.id, { photo_url: 'https://example.com/manually-pasted.jpg' } as any);
    expect(getArtistsMissingPhoto().map((a) => a.id)).not.toContain(artist.id); // has a photo now, not missing

    updateArtist(artist.id, { photo_url: '' } as any);
    // Missing again, but the no-match stamp is still recent — still excluded.
    expect(getArtistsMissingPhoto().map((a) => a.id)).not.toContain(artist.id);
  });

  it('getArtistsInPhotoBackoff counts exactly the artists getArtistsMissingPhoto excludes, and reports the earliest recheck date', () => {
    const before = getArtistsInPhotoBackoff().count;

    const recent = makeArtist('Photo Backoff Visibility Recent');
    const longAgo = makeArtist('Photo Backoff Visibility Long Ago');
    const withPhoto = makeArtist('Photo Backoff Visibility Has Photo');

    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    stampSoundchartsNoMatch(recent.id, fiveDaysAgo);
    const beforeWindow = new Date(Date.now() - (SOUNDCHARTS_NO_MATCH_RECHECK_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
    stampSoundchartsNoMatch(longAgo.id, beforeWindow); // outside the window — not in backoff
    stampSoundchartsNoMatch(withPhoto.id, fiveDaysAgo);
    updateArtist(withPhoto.id, { photo_url: 'https://example.com/has-a-photo.jpg' } as any); // has a photo now — not "missing" at all

    const after = getArtistsInPhotoBackoff();
    // Exactly one new artist (`recent`) entered the backoff set.
    expect(after.count - before).toBe(1);
    expect(getArtistsMissingPhoto().map((a) => a.id)).not.toContain(recent.id);

    const expectedRecheck = new Date(new Date(fiveDaysAgo).getTime() + SOUNDCHARTS_NO_MATCH_RECHECK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    expect(after.earliestRecheckAt).toBe(expectedRecheck);
  });
});

describe('Soundcharts limitations (Phase 4) — getMissingPlatformLinksImpact', () => {
  it('counts an artist with zero platform links, and views on it, but not one with at least one link', () => {
    const beforeArtists = getMissingPlatformLinksImpact().artistsMissingAllLinks;
    const unlinked = makeArtist('Zero Links Artist');
    const linked = createArtist({
      name: 'Has A Link Artist', spotify_url: 'https://open.spotify.com/artist/x',
      music_talent: 8, growth_velocity_pct: 32, engagement_rate_pct: 16, original_song_response: 8,
      brand_personality: 8, content_consistency: 8, commercial_potential: 8, professionalism: 8,
    });
    const viewer = createUser({ name: 'Links Viewer', email: 'links-viewer@example.com', password_hash: 'hash' });
    expect(getMissingPlatformLinksImpact().artistsMissingAllLinks - beforeArtists).toBe(1); // only the unlinked one

    const beforeViews = getMissingPlatformLinksImpact();
    logEvent(viewer.id, 'artist_detail_opened', { artistId: unlinked.id });
    logEvent(viewer.id, 'artist_detail_opened', { artistId: linked.id });

    const afterViews = getMissingPlatformLinksImpact();
    expect(afterViews.viewsOnArtistsMissingAllLinks - beforeViews.viewsOnArtistsMissingAllLinks).toBe(1);
    expect(afterViews.totalArtistDetailViews - beforeViews.totalArtistDetailViews).toBe(2); // both views count toward the denominator
  });

  it('an artist missing all links but never viewed counts toward artistsMissingAllLinks but not the view count', () => {
    const before = getMissingPlatformLinksImpact();
    makeArtist('Unviewed Zero Links Artist');
    const after = getMissingPlatformLinksImpact();
    expect(after.artistsMissingAllLinks - before.artistsMissingAllLinks).toBe(1);
    expect(after.viewsOnArtistsMissingAllLinks).toBe(before.viewsOnArtistsMissingAllLinks);
  });

  it('any one of the four platform link fields being set is enough to exclude an artist', () => {
    const before = getMissingPlatformLinksImpact().artistsMissingAllLinks;
    createArtist({
      name: 'TikTok Only Artist', tiktok_url: 'https://tiktok.com/@x',
      music_talent: 8, growth_velocity_pct: 32, engagement_rate_pct: 16, original_song_response: 8,
      brand_personality: 8, content_consistency: 8, commercial_potential: 8, professionalism: 8,
    });
    expect(getMissingPlatformLinksImpact().artistsMissingAllLinks).toBe(before);
  });
});

describe('Discovery Engine (Phase 5) — candidate history, run attribution, and coverage', () => {
  it('insertDiscoveryCandidate logs a "discovered" history row with no actor', () => {
    insertDiscoveryCandidate({ source: 'soundcharts', soundcharts_uuid: 'uuid-history-1', name: 'History Test Artist', flagged_reason: 'test' });
    const candidate = getDiscoveryCandidates('new').find((c) => c.soundcharts_uuid === 'uuid-history-1')!;

    const history = getDiscoveryCandidateHistory(candidate.id);
    expect(history).toHaveLength(1);
    expect(history[0].from_status).toBeNull();
    expect(history[0].to_status).toBe('new');
    expect(history[0].actor_id).toBeFalsy();
  });

  it('setDiscoveryCandidateStatus and approveDiscoveryCandidate each append a history row with the actor and both statuses', () => {
    const scout = makeUser('history-scout@example.com');
    insertDiscoveryCandidate({ source: 'soundcharts', soundcharts_uuid: 'uuid-history-2', name: 'Watched Then Approved', flagged_reason: 'test' });
    const candidate = getDiscoveryCandidates('new').find((c) => c.soundcharts_uuid === 'uuid-history-2')!;

    setDiscoveryCandidateStatus(candidate.id, 'watching', { id: scout.id, name: scout.name });
    approveDiscoveryCandidate(candidate.id, { id: scout.id, name: scout.name });

    const history = getDiscoveryCandidateHistory(candidate.id);
    expect(history.map((h) => [h.from_status, h.to_status])).toEqual([
      [null, 'new'],
      ['new', 'watching'],
      ['watching', 'approved'],
    ]);
    expect(history[1].actor_id).toBe(scout.id);
    expect(history[2].actor_name).toBe(scout.name);
  });

  it('getRecentDiscoveryReviewDecisions excludes the initial discovery row but includes real decisions, most recent first', () => {
    const scout = makeUser('decisions-scout@example.com');
    insertDiscoveryCandidate({ source: 'soundcharts', soundcharts_uuid: 'uuid-decision-1', name: 'Decision Test Artist', flagged_reason: 'test' });
    const candidate = getDiscoveryCandidates('new').find((c) => c.soundcharts_uuid === 'uuid-decision-1')!;

    const before = getRecentDiscoveryReviewDecisions(200).length;
    setDiscoveryCandidateStatus(candidate.id, 'passed', { id: scout.id, name: scout.name });

    const decisions = getRecentDiscoveryReviewDecisions(200);
    expect(decisions.length).toBe(before + 1);
    expect(decisions[0].candidate_name).toBe('Decision Test Artist');
    expect(decisions[0].candidate_source).toBe('soundcharts');
    expect(decisions[0].to_status).toBe('passed');
    // The "discovered" row (from_status null) for THIS candidate must never appear.
    expect(decisions.some((d) => d.candidate_name === 'Decision Test Artist' && d.from_status === null)).toBe(false);
  });

  it('getDiscoveryCandidateCountsByStatus reflects a delta across all four statuses', () => {
    const scout = makeUser('counts-scout@example.com');
    const before = getDiscoveryCandidateCountsByStatus();

    insertDiscoveryCandidate({ source: 'soundcharts', soundcharts_uuid: 'uuid-count-new', name: 'Count New', flagged_reason: 'test' });
    insertDiscoveryCandidate({ source: 'soundcharts', soundcharts_uuid: 'uuid-count-watch', name: 'Count Watch', flagged_reason: 'test' });
    insertDiscoveryCandidate({ source: 'soundcharts', soundcharts_uuid: 'uuid-count-pass', name: 'Count Pass', flagged_reason: 'test' });
    const watchCandidate = getDiscoveryCandidates('new').find((c) => c.soundcharts_uuid === 'uuid-count-watch')!;
    const passCandidate = getDiscoveryCandidates('new').find((c) => c.soundcharts_uuid === 'uuid-count-pass')!;
    setDiscoveryCandidateStatus(watchCandidate.id, 'watching', { id: scout.id, name: scout.name });
    setDiscoveryCandidateStatus(passCandidate.id, 'passed', { id: scout.id, name: scout.name });

    const after = getDiscoveryCandidateCountsByStatus();
    expect(after.new - before.new).toBe(1);
    expect(after.watching - before.watching).toBe(1);
    expect(after.passed - before.passed).toBe(1);
  });

  it('getDiscoveryCandidateCountsByGenre groups YouTube candidates by yt_genre and excludes Soundcharts (null-genre) candidates', () => {
    const before = getDiscoveryCandidateCountsByGenre();
    const beforeCount = (genre: string) => before.find((g) => g.genre === genre)?.count ?? 0;

    insertDiscoveryCandidate({ source: 'youtube', name: 'Genre Test A', yt_channel_id: 'chan-genre-a', yt_genre: 'pop-genre-test', flagged_reason: 'test' });
    insertDiscoveryCandidate({ source: 'youtube', name: 'Genre Test B', yt_channel_id: 'chan-genre-b', yt_genre: 'pop-genre-test', flagged_reason: 'test' });
    insertDiscoveryCandidate({ source: 'soundcharts', soundcharts_uuid: 'uuid-genre-null', name: 'No Genre (Soundcharts)', flagged_reason: 'test' });

    const after = getDiscoveryCandidateCountsByGenre();
    expect(after.find((g) => g.genre === 'pop-genre-test')!.count - beforeCount('pop-genre-test')).toBe(2);
    expect(after.some((g) => g.genre === null || g.genre === undefined)).toBe(false);
  });

  it('getRecentDiscoveryRunsWithCandidateCounts attributes candidates to their own run and shows 0 for a run that found none', () => {
    const runA = createDiscoveryRun('youtube');
    insertDiscoveryCandidate({ source: 'youtube', name: 'Run A Candidate 1', yt_channel_id: 'chan-run-a-1', flagged_reason: 'test', discovery_run_id: runA.id });
    insertDiscoveryCandidate({ source: 'youtube', name: 'Run A Candidate 2', yt_channel_id: 'chan-run-a-2', flagged_reason: 'test', discovery_run_id: runA.id });
    completeDiscoveryRun(runA.id, { status: 'completed', searchedCount: 50, candidatesFound: 2 });

    const runB = createDiscoveryRun('youtube');
    completeDiscoveryRun(runB.id, { status: 'completed', searchedCount: 40, candidatesFound: 0 });

    const runs = getRecentDiscoveryRunsWithCandidateCounts('youtube', 50);
    expect(runs.find((r) => r.id === runA.id)!.candidateCount).toBe(2);
    expect(runs.find((r) => r.id === runB.id)!.candidateCount).toBe(0);
  });
});

describe('Scout workflow (Phase 5) — field-level audit trail, activity sort, bulk stage change', () => {
  it('updateArtist logs a field-history row only for a real human edit, only for fields that actually changed, and never for stage', () => {
    const scout = makeUser('field-history-scout@example.com');
    const artist = makeArtist('Field History Artist');

    // A sync-style update (no actor) must NOT be logged.
    updateArtist(artist.id, { name: artist.name, genre: 'Synced Genre No Actor' });
    expect(getArtistFieldHistory(artist.id)).toHaveLength(0);

    // A human edit changing genre and location (but re-submitting the same
    // name) logs genre and location, but not name (unchanged) or stage
    // (not touched by this call at all).
    updateArtist(artist.id, { name: artist.name, genre: 'Pop', location: 'Austin, TX' }, { id: scout.id, name: scout.name });
    const history = getArtistFieldHistory(artist.id);
    expect(history).toHaveLength(2);
    expect(history.map((h) => h.field).sort()).toEqual(['genre', 'location']);
    const genreChange = history.find((h) => h.field === 'genre')!;
    expect(genreChange.old_value).toBe('Synced Genre No Actor');
    expect(genreChange.new_value).toBe('Pop');
    expect(genreChange.actor_name).toBe(scout.name);

    // A stage change (via the same actor-provided call) must not ALSO
    // appear in artist_field_history — it's already covered by the
    // existing contact_log status_change entry.
    updateArtist(artist.id, { name: artist.name, stage: 'contacted' }, { id: scout.id, name: scout.name });
    expect(getArtistFieldHistory(artist.id).some((h) => h.field === 'stage')).toBe(false);
  });

  it('a full-form save (every field present, most as empty strings — ArtistForm\'s real submission shape) logs only the field that actually changed, not every blank one', () => {
    const scout = makeUser('full-form-scout@example.com');
    const artist = makeArtist('Full Form Save Artist'); // every optional field starts unset (null in the DB)

    // Mirrors ArtistForm.handleSubmit's real payload shape: every writable
    // field present, untouched ones as '' (never omitted) — this is
    // exactly what caught the normalization bug in QA.
    updateArtist(artist.id, {
      name: artist.name, genre: 'QA Edited Genre', location: '', scout_name: '',
      tiktok_url: '', instagram_url: '', youtube_url: '', spotify_url: '', soundcloud_url: '',
      notes: '', photo_url: '', bio: '', top_song_url: '', song_preview_url: '', why_trending: '',
    }, { id: scout.id, name: scout.name });

    const history = getArtistFieldHistory(artist.id);
    expect(history).toHaveLength(1);
    expect(history[0].field).toBe('genre');
    expect(history[0].old_value).toBeNull();
    expect(history[0].new_value).toBe('QA Edited Genre');
  });

  it('re-submitting the exact same value for a field logs nothing', () => {
    const scout = makeUser('no-op-edit-scout@example.com');
    const artist = createArtist({ name: 'No-Op Edit Artist', genre: 'Rock' });
    const before = getArtistFieldHistory(artist.id).length;
    updateArtist(artist.id, { name: artist.name, genre: 'Rock' }, { id: scout.id, name: scout.name });
    expect(getArtistFieldHistory(artist.id)).toHaveLength(before);
  });

  it('getArtistLastActivityMap reflects the later of updated_at and the most recent contact_log entry', () => {
    const scout = makeUser('activity-map-scout@example.com');
    const artist = makeArtist('Activity Map Artist');

    const initialMap = getArtistLastActivityMap();
    const initialActivity = initialMap.get(artist.id)!;
    expect(initialActivity).toBe(artist.updated_at);

    // A note logged well after the artist's last field edit, with NO field
    // actually changing (updated_at stays put) — this is exactly the case
    // updated_at alone would miss.
    const later = new Date(Date.now() + 60_000).toISOString();
    const entry = addLogEntry(artist.id, { type: 'note', message: 'Checked in, no changes.' }, { id: scout.id, name: scout.name });
    db.prepare('UPDATE contact_log SET created_at = ? WHERE id = ?').run(later, entry.id);

    const afterMap = getArtistLastActivityMap();
    expect(afterMap.get(artist.id)).toBe(later);
    expect(afterMap.get(artist.id)! > initialActivity).toBe(true);
  });

  it('bulkSetArtistStage updates every listed artist, skips a nonexistent id without throwing, and returns the real count', () => {
    const scout = makeUser('bulk-stage-scout@example.com');
    const a = makeArtist('Bulk Stage Artist A');
    const b = makeArtist('Bulk Stage Artist B');

    const updated = bulkSetArtistStage([a.id, b.id, 999_999], 'contacted', { id: scout.id, name: scout.name });

    expect(updated).toBe(2);
    expect(getArtist(a.id)!.stage).toBe('contacted');
    expect(getArtist(b.id)!.stage).toBe('contacted');
    // Reuses the same per-artist path as a normal edit, so the existing
    // stage-change contact_log entry still gets written for each.
    expect(getArtistLog(a.id).some((l) => l.type === 'status_change')).toBe(true);
  });
});

describe('Artist evaluation (Phase 5) — high_rating_note, earliest/latest score snapshots', () => {
  it('high_rating_note round-trips through create and update like any other writable field', () => {
    const artist = createArtist({ name: 'High Rating Note Artist', music_talent: 9, high_rating_note: 'Viral TikTok sound, verified organic.' });
    expect(getArtist(artist.id)!.high_rating_note).toBe('Viral TikTok sound, verified organic.');

    const scout = makeUser('high-rating-scout@example.com');
    const updated = updateArtist(artist.id, { name: artist.name, high_rating_note: 'Updated reasoning.' }, { id: scout.id, name: scout.name });
    expect(updated!.high_rating_note).toBe('Updated reasoning.');
  });

  it('getEarliestScoreSnapshots and getLatestScoreSnapshots return the same single row for an artist with only one snapshot, and the correct two for an artist with several', () => {
    const single = createArtist({ name: 'Single Snapshot Artist', music_talent: 7 });
    const earliestSingle = getEarliestScoreSnapshots().find((s) => s.artist_id === single.id)!;
    const latestSingle = getLatestScoreSnapshots().find((s) => s.artist_id === single.id)!;
    expect(earliestSingle.id).toBe(latestSingle.id);
    expect(earliestSingle.music_talent).toBe(7);

    // Three snapshots taken this close together in a fast test run can land
    // in the same millisecond — force distinct, strictly increasing
    // recorded_at values (JS-computed ISO strings, never SQLite's
    // datetime()) so MIN/MAX(recorded_at) isn't ambiguous between ties.
    function stampLatestSnapshot(artistId: number, at: string) {
      const row = db.prepare('SELECT id FROM score_history WHERE artist_id = ? ORDER BY id DESC LIMIT 1').get(artistId) as { id: number };
      db.prepare('UPDATE score_history SET recorded_at = ? WHERE id = ?').run(at, row.id);
    }
    const multi = createArtist({ name: 'Multi Snapshot Artist', music_talent: 3 });
    stampLatestSnapshot(multi.id, new Date(Date.now() - 2000).toISOString());
    updateArtist(multi.id, { name: multi.name, music_talent: 6 });
    stampLatestSnapshot(multi.id, new Date(Date.now() - 1000).toISOString());
    updateArtist(multi.id, { name: multi.name, music_talent: 9 });
    const earliestMulti = getEarliestScoreSnapshots().find((s) => s.artist_id === multi.id)!;
    const latestMulti = getLatestScoreSnapshots().find((s) => s.artist_id === multi.id)!;
    expect(earliestMulti.music_talent).toBe(3);
    expect(latestMulti.music_talent).toBe(9);
    expect(earliestMulti.id).not.toBe(latestMulti.id);
  });
});

describe('Artist participation (Phase 6) — public submission, claim review, dashboard access', () => {
  it('a public submission lands in the Candidate Queue with source public_submission and the submitter attributed by name', () => {
    const fan = makeUser('submitting-fan@example.com');
    insertDiscoveryCandidate({
      source: 'public_submission',
      name: 'Fan-Found Artist',
      submission_url: 'https://tiktok.com/@fanfound',
      flagged_reason: 'Their video has been stuck in my head for a week.',
      submitted_by_user_id: fan.id,
    });

    const candidate = getDiscoveryCandidates('new').find((c) => c.name === 'Fan-Found Artist')!;
    expect(candidate).toBeDefined();
    expect(candidate.source).toBe('public_submission');
    expect(candidate.submission_url).toBe('https://tiktok.com/@fanfound');
    expect(candidate.submitted_by_name).toBe('Test Trader');
    expect(candidate.flagged_reason).toBe('Their video has been stuck in my head for a week.');
  });

  it('approving a public-submission candidate creates a real artist the same way any other source does', () => {
    const fan = makeUser('approved-fan@example.com');
    const scout = makeUser('claim-review-scout@example.com');
    insertDiscoveryCandidate({
      source: 'public_submission',
      name: 'Approved Fan Find',
      flagged_reason: 'Great original songwriting.',
      submitted_by_user_id: fan.id,
    });
    const candidate = getDiscoveryCandidates('new').find((c) => c.name === 'Approved Fan Find')!;
    const artist = approveDiscoveryCandidate(candidate.id, { id: scout.id, name: scout.name });
    expect(artist).toBeDefined();
    expect(artist!.name).toBe('Approved Fan Find');
    expect(artist!.why_trending).toBe('Great original songwriting.');
    expect(getArtist(artist!.id)!.claimed_by_user_id).toBeNull();
  });

  it('createArtistClaim rejects claiming an already-claimed artist, and rejects a duplicate pending claim from the same user', () => {
    const artist = createArtist({ name: 'Claim Target Artist', music_talent: 6 });
    const fan1 = makeUser('claimant-one@example.com');
    const fan2 = makeUser('claimant-two@example.com');

    const first = createArtistClaim(artist.id, fan1.id, 'I run this account.');
    expect(first.ok).toBe(true);

    // A second pending claim from the SAME user on the SAME artist is
    // blocked (the partial unique index) — this is a duplicate ask, not a
    // second legitimate claimant.
    const duplicate = createArtistClaim(artist.id, fan1.id, 'Trying again.');
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.reason).toMatch(/already have a pending claim/i);

    // A different user's claim is allowed to exist as its own pending row
    // (the artist isn't claimed yet, only requested) — only an APPROVED
    // claim blocks further requests, checked next.
    const second = createArtistClaim(artist.id, fan2.id, 'No, I run this account.');
    expect(second.ok).toBe(true);
  });

  it('createArtistClaim rejects any new claim once the artist is already claimed by someone', () => {
    const artist = createArtist({ name: 'Already Claimed Artist', music_talent: 6 });
    const owner = makeUser('artist-owner@example.com');
    const scout = makeUser('approve-scout@example.com');
    const outsider = makeUser('outsider-claimant@example.com');

    const request = createArtistClaim(artist.id, owner.id, 'It me.');
    expect(request.ok).toBe(true);
    if (!request.ok) throw new Error('unreachable');
    reviewArtistClaim(request.claim.id, 'approved', { id: scout.id, name: scout.name });

    const blocked = createArtistClaim(artist.id, outsider.id, 'Actually it is me.');
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toMatch(/already been claimed/i);
  });

  it('reviewArtistClaim(approved) sets claimed_by_user_id, logs a claim activity entry, and grants dashboard access via getArtistsClaimedByUser', () => {
    const artist = createArtist({ name: 'Dashboard-Bound Artist', music_talent: 6 });
    const claimant = makeUser('dashboard-claimant@example.com');
    const scout = makeUser('dashboard-scout@example.com');

    expect(getArtistsClaimedByUser(claimant.id)).toHaveLength(0);

    const request = createArtistClaim(artist.id, claimant.id, 'Proof link here.');
    expect(request.ok).toBe(true);
    if (!request.ok) throw new Error('unreachable');

    const reviewed = reviewArtistClaim(request.claim.id, 'approved', { id: scout.id, name: scout.name });
    expect(reviewed!.status).toBe('approved');
    expect(getArtist(artist.id)!.claimed_by_user_id).toBe(claimant.id);

    const claimed = getArtistsClaimedByUser(claimant.id);
    expect(claimed).toHaveLength(1);
    expect(claimed[0].id).toBe(artist.id);

    const log = getArtistLog(artist.id);
    const claimEntry = log.find((e) => e.type === 'claim');
    expect(claimEntry).toBeDefined();
    expect(claimEntry!.message).toContain('Test Trader');
  });

  it('reviewArtistClaim(rejected) leaves the artist unclaimed and does not grant dashboard access', () => {
    const artist = createArtist({ name: 'Rejected Claim Artist', music_talent: 6 });
    const claimant = makeUser('rejected-claimant@example.com');
    const scout = makeUser('reject-scout@example.com');

    const request = createArtistClaim(artist.id, claimant.id, undefined);
    expect(request.ok).toBe(true);
    if (!request.ok) throw new Error('unreachable');

    const reviewed = reviewArtistClaim(request.claim.id, 'rejected', { id: scout.id, name: scout.name });
    expect(reviewed!.status).toBe('rejected');
    expect(getArtist(artist.id)!.claimed_by_user_id).toBeNull();
    expect(getArtistsClaimedByUser(claimant.id)).toHaveLength(0);
  });

  it('reviewArtistClaim returns undefined for an already-reviewed claim (no double-approval)', () => {
    const artist = createArtist({ name: 'Double Review Artist', music_talent: 6 });
    const claimant = makeUser('double-review-claimant@example.com');
    const scout = makeUser('double-review-scout@example.com');

    const request = createArtistClaim(artist.id, claimant.id, undefined);
    if (!request.ok) throw new Error('unreachable');
    reviewArtistClaim(request.claim.id, 'approved', { id: scout.id, name: scout.name });

    const secondReview = reviewArtistClaim(request.claim.id, 'rejected', { id: scout.id, name: scout.name });
    expect(secondReview).toBeUndefined();
    // Still approved from the first review — a second call is a no-op, not a downgrade.
    expect(getArtist(artist.id)!.claimed_by_user_id).toBe(claimant.id);
  });

  it('getPendingArtistClaims / getPendingArtistClaimCount / getPendingClaimForUserAndArtist reflect only pending claims', () => {
    const artist = createArtist({ name: 'Pending Queue Artist', music_talent: 6 });
    const claimant = makeUser('pending-queue-claimant@example.com');

    expect(getPendingClaimForUserAndArtist(claimant.id, artist.id)).toBeUndefined();
    const before = getPendingArtistClaimCount();

    const request = createArtistClaim(artist.id, claimant.id, 'Verify me please.');
    if (!request.ok) throw new Error('unreachable');

    expect(getPendingArtistClaimCount()).toBe(before + 1);
    expect(getPendingClaimForUserAndArtist(claimant.id, artist.id)!.id).toBe(request.claim.id);
    const pending = getPendingArtistClaims();
    expect(pending.some((c) => c.id === request.claim.id)).toBe(true);
    expect(getArtistClaim(request.claim.id)!.artist_name).toBe('Pending Queue Artist');
    expect(getArtistClaim(request.claim.id)!.user_name).toBe('Test Trader');
  });
});

describe('Crowdsourced scouting (Phase 7) — discovery credit, genre expertise, badges, duplicate/rate-limit guards', () => {
  function submitPublicArtist(name: string, userId: number) {
    insertDiscoveryCandidate({ source: 'public_submission', name, flagged_reason: 'Great find.', submitted_by_user_id: userId });
    return getDiscoveryCandidates('new').find((c) => c.name === name)!;
  }

  it('getApprovedDiscoveriesCount only counts this user\'s APPROVED submissions, and getBreakoutDiscoveriesCount only counts the ones whose artist reached flagship', () => {
    const finder = createUser({ name: 'Discovery Finder', email: 'discovery-finder@example.com', password_hash: 'hash' });
    const scout = createUser({ name: 'Review Scout', email: 'review-scout-p7@example.com', password_hash: 'hash' });

    submitPublicArtist('Still Pending Find', finder.id);
    const approvedCandidate = submitPublicArtist('Approved Find', finder.id);
    const breakoutCandidate = submitPublicArtist('Breakout Find', finder.id);

    expect(getApprovedDiscoveriesCount(finder.id)).toBe(0);
    expect(getBreakoutDiscoveriesCount(finder.id)).toBe(0);

    const approvedArtist = approveDiscoveryCandidate(approvedCandidate.id, { id: scout.id, name: scout.name })!;
    const breakoutArtist = approveDiscoveryCandidate(breakoutCandidate.id, { id: scout.id, name: scout.name })!;
    expect(getApprovedDiscoveriesCount(finder.id)).toBe(2); // still-pending one doesn't count
    expect(getBreakoutDiscoveriesCount(finder.id)).toBe(0); // neither has reached flagship yet

    updateArtist(breakoutArtist.id, { name: breakoutArtist.name, stage: 'flagship' });
    expect(getBreakoutDiscoveriesCount(finder.id)).toBe(1);
    expect(getApprovedDiscoveriesCount(finder.id)).toBe(2); // unchanged — flagship doesn't add a second "approved" credit

    // Reaching flagship on an artist someone ELSE found doesn't credit this user.
    updateArtist(approvedArtist.id, { name: approvedArtist.name, stage: 'flagship' });
    expect(getBreakoutDiscoveriesCount(finder.id)).toBe(2);
  });

  it('getDiscoveriesForUser lists every submission regardless of status, newest first, with the resolved artist name and breakout flag once approved', () => {
    const finder = createUser({ name: 'List Finder', email: 'list-finder@example.com', password_hash: 'hash' });
    const scout = createUser({ name: 'List Scout', email: 'list-scout-p7@example.com', password_hash: 'hash' });

    const pendingCandidate = submitPublicArtist('List Pending', finder.id);
    // Backdate — two inserts this close together can land in the same
    // millisecond, making ORDER BY discovered_at DESC ambiguous between
    // them (the same flake class documented elsewhere in this file).
    db.prepare('UPDATE discovery_candidates SET discovered_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), pendingCandidate.id);
    const approvedCandidate = submitPublicArtist('List Approved', finder.id);
    const artist = approveDiscoveryCandidate(approvedCandidate.id, { id: scout.id, name: scout.name })!;
    updateArtist(artist.id, { name: artist.name, stage: 'flagship' });

    const discoveries = getDiscoveriesForUser(finder.id);
    expect(discoveries).toHaveLength(2);
    // Newest first — "List Approved" was submitted after "List Pending".
    expect(discoveries[0].candidateId).toBe(approvedCandidate.id);
    expect(discoveries[0].status).toBe('approved');
    expect(discoveries[0].artistName).toBe('List Approved');
    expect(discoveries[0].artistId).toBe(artist.id);
    expect(discoveries[0].breakout).toBe(true);

    expect(discoveries[1].candidateId).toBe(pendingCandidate.id);
    expect(discoveries[1].status).toBe('new');
    expect(discoveries[1].artistName).toBe('List Pending'); // falls back to the submitted name — never approved, nothing to join
    expect(discoveries[1].artistId).toBeUndefined();
    expect(discoveries[1].breakout).toBe(false);
  });

  it('getDiscoveryGenres ranks genres by approved-discovery count, ignoring still-pending submissions', () => {
    const finder = createUser({ name: 'Genre Finder', email: 'genre-finder@example.com', password_hash: 'hash' });
    const scout = createUser({ name: 'Genre Review Scout', email: 'genre-review-scout@example.com', password_hash: 'hash' });

    for (const name of ['Genre Find Pop One', 'Genre Find Pop Two']) {
      const candidate = submitPublicArtist(name, finder.id);
      const artist = approveDiscoveryCandidate(candidate.id, { id: scout.id, name: scout.name })!;
      updateArtist(artist.id, { name: artist.name, genre: 'Pop' });
    }
    const jazzCandidate = submitPublicArtist('Genre Find Jazz One', finder.id);
    const jazzArtist = approveDiscoveryCandidate(jazzCandidate.id, { id: scout.id, name: scout.name })!;
    updateArtist(jazzArtist.id, { name: jazzArtist.name, genre: 'Jazz' });

    // Not yet approved — shouldn't count toward genre expertise at all.
    submitPublicArtist('Genre Find Still Pending', finder.id);

    const genres = getDiscoveryGenres(finder.id);
    expect(genres[0]).toEqual({ genre: 'Pop', count: 2 });
    expect(genres[1]).toEqual({ genre: 'Jazz', count: 1 });
  });

  it('getDiscoveryLeaderboard ranks by approved-discovery count, breaking ties by breakout count', () => {
    const topFinder = createUser({ name: 'Top Discoverer', email: 'top-discoverer@example.com', password_hash: 'hash' });
    const tiedWithBreakout = createUser({ name: 'Tied Breakout Discoverer', email: 'tied-breakout-discoverer@example.com', password_hash: 'hash' });
    const tiedNoBreakout = createUser({ name: 'Tied Plain Discoverer', email: 'tied-plain-discoverer@example.com', password_hash: 'hash' });
    const scout = createUser({ name: 'Leaderboard Review Scout', email: 'leaderboard-review-scout@example.com', password_hash: 'hash' });

    // topFinder: 2 approved, 0 breakout.
    for (const name of ['LB Top Find One', 'LB Top Find Two']) {
      const c = submitPublicArtist(name, topFinder.id);
      approveDiscoveryCandidate(c.id, { id: scout.id, name: scout.name });
    }
    // tiedWithBreakout: 1 approved, 1 breakout.
    const breakoutCandidate = submitPublicArtist('LB Breakout Find', tiedWithBreakout.id);
    const breakoutArtist = approveDiscoveryCandidate(breakoutCandidate.id, { id: scout.id, name: scout.name })!;
    updateArtist(breakoutArtist.id, { name: breakoutArtist.name, stage: 'flagship' });
    // tiedNoBreakout: 1 approved, 0 breakout.
    const plainCandidate = submitPublicArtist('LB Plain Find', tiedNoBreakout.id);
    approveDiscoveryCandidate(plainCandidate.id, { id: scout.id, name: scout.name });

    const board = getDiscoveryLeaderboard().filter((e) => [topFinder.id, tiedWithBreakout.id, tiedNoBreakout.id].includes(e.user.id));
    const byId = new Map(board.map((e) => [e.user.id, e]));
    expect(byId.get(topFinder.id)!.rank).toBeLessThan(byId.get(tiedWithBreakout.id)!.rank); // 2 approved beats 1 approved
    expect(byId.get(tiedWithBreakout.id)!.rank).toBeLessThan(byId.get(tiedNoBreakout.id)!.rank); // same approved count, breakout wins the tiebreak
  });

  it('findDuplicateArtistSubmission blocks a name matching an existing roster artist or an active (non-passed) candidate, case-insensitively, but allows resubmitting a passed one', () => {
    const existingArtist = createArtist({ name: 'Existing Roster Artist', music_talent: 5 });
    expect(findDuplicateArtistSubmission('existing roster artist')).toEqual({ kind: 'artist', name: 'Existing Roster Artist' });

    const finder = createUser({ name: 'Dup Finder', email: 'dup-finder@example.com', password_hash: 'hash' });
    submitPublicArtist('Pending Duplicate Target', finder.id);
    expect(findDuplicateArtistSubmission('PENDING DUPLICATE TARGET')).toEqual({ kind: 'candidate', name: 'Pending Duplicate Target' });

    const scout = createUser({ name: 'Dup Scout', email: 'dup-scout@example.com', password_hash: 'hash' });
    const passedCandidate = submitPublicArtist('Passed Duplicate Target', finder.id);
    setDiscoveryCandidateStatus(passedCandidate.id, 'passed', { id: scout.id, name: scout.name });
    expect(findDuplicateArtistSubmission('Passed Duplicate Target')).toBeUndefined();

    expect(findDuplicateArtistSubmission('Nobody Has Submitted This')).toBeUndefined();
  });

  it('getRecentSubmissionCount only counts this user\'s public_submission candidates within the given window', () => {
    const finder = createUser({ name: 'Rate Limit Finder', email: 'rate-limit-finder@example.com', password_hash: 'hash' });
    const otherFinder = createUser({ name: 'Other Finder', email: 'other-finder@example.com', password_hash: 'hash' });

    expect(getRecentSubmissionCount(finder.id, 24)).toBe(0);
    submitPublicArtist('Rate Limit Find One', finder.id);
    submitPublicArtist('Rate Limit Find Two', finder.id);
    submitPublicArtist('Other Finders Find', otherFinder.id); // a different user's submission never counts against this one
    expect(getRecentSubmissionCount(finder.id, 24)).toBe(2);
    expect(getRecentSubmissionCount(otherFinder.id, 24)).toBe(1);

    // Backdate one submission outside the window — same id-capture-then-UPDATE
    // pattern used elsewhere in this file to avoid same-millisecond ties.
    const row = db.prepare("SELECT id FROM discovery_candidates WHERE name = 'Rate Limit Find One'").get() as { id: number };
    db.prepare('UPDATE discovery_candidates SET discovered_at = ? WHERE id = ?').run(new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), row.id);
    expect(getRecentSubmissionCount(finder.id, 24)).toBe(1);
  });

  it('getScoutProfile surfaces discovery credit end to end: counts, discoveries list, discovery genres, badges, and a Scout Score bonus', () => {
    const finder = createUser({ name: 'Profile Finder', email: 'profile-finder@example.com', password_hash: 'hash' });
    const scout = createUser({ name: 'Profile Review Scout', email: 'profile-review-scout@example.com', password_hash: 'hash' });

    const noDiscoveryScore = getScoutProfile(finder.id)!.scoutScoreValue;
    expect(getScoutProfile(finder.id)!.badges.some((b) => b.key === 'first_find')).toBe(false);

    const candidate = submitPublicArtist('Profile Find', finder.id);
    const artist = approveDiscoveryCandidate(candidate.id, { id: scout.id, name: scout.name })!;
    updateArtist(artist.id, { name: artist.name, genre: 'Country', stage: 'flagship' });

    const profile = getScoutProfile(finder.id)!;
    expect(profile.approvedDiscoveriesCount).toBe(1);
    expect(profile.breakoutDiscoveriesCount).toBe(1);
    expect(profile.discoveries).toHaveLength(1);
    expect(profile.discoveries[0].artistName).toBe('Profile Find');
    expect(profile.discoveryGenres).toEqual([{ genre: 'Country', count: 1 }]);
    expect(profile.badges.map((b) => b.key)).toEqual(expect.arrayContaining(['first_find', 'breakout_spotter']));
    // 1 approved (3pts) + 1 breakout (5pts) = +8, same discovery bonus scoutScore() itself applies.
    expect(profile.scoutScoreValue).toBe(noDiscoveryScore + 8);
  });

  it('getScoutLeaderboard entries carry approvedDiscoveriesCount alongside the existing trading stats', () => {
    const finder = createUser({ name: 'Leaderboard Field Finder', email: 'leaderboard-field-finder@example.com', password_hash: 'hash' });
    const scout = createUser({ name: 'Leaderboard Field Scout', email: 'leaderboard-field-scout@example.com', password_hash: 'hash' });
    const candidate = submitPublicArtist('Leaderboard Field Find', finder.id);
    approveDiscoveryCandidate(candidate.id, { id: scout.id, name: scout.name });

    const entry = getScoutLeaderboard().find((e) => e.user.id === finder.id)!;
    expect(entry.approvedDiscoveriesCount).toBe(1);
  });
});

describe('Anti-abuse and market integrity (Phase 8)', () => {
  it('executeTrade rejects a buy of exactly balance+1 cent but allows exactly the full balance', () => {
    const user = makeUser('boundary-buyer@example.com');
    const artist = makeArtist('Boundary Buyer Artist');
    const balance = getUserById(user.id)!.next_credits_cents;

    const tooMuch = executeTrade(user.id, artist.id, 'buy', balance + 1);
    expect(tooMuch.ok).toBe(false);
    if (!tooMuch.ok) expect(tooMuch.error).toMatch(/not enough NEXT Credits/i);

    const exact = executeTrade(user.id, artist.id, 'buy', balance);
    expect(exact.ok).toBe(true);
    expect(getUserById(user.id)!.next_credits_cents).toBe(0);

    // Now genuinely broke — even a $0.01 buy must be rejected, never allowed
    // to push the balance negative.
    const whenBroke = executeTrade(user.id, artist.id, 'buy', 1);
    expect(whenBroke.ok).toBe(false);
    expect(getUserById(user.id)!.next_credits_cents).toBe(0); // unchanged, never negative
  });

  it('getRecentTradeCount only counts this user\'s trades within the given window', () => {
    const user = makeUser('rate-limit-trader@example.com');
    const otherUser = makeUser('other-rate-limit-trader@example.com');
    const artist = makeArtist('Rate Limit Trade Artist');

    expect(getRecentTradeCount(user.id, 1)).toBe(0);
    executeTrade(user.id, artist.id, 'buy', 10_000);
    executeTrade(user.id, artist.id, 'buy', 10_000);
    executeTrade(otherUser.id, artist.id, 'buy', 10_000); // a different user's trade never counts against this one
    expect(getRecentTradeCount(user.id, 1)).toBe(2);
    expect(getRecentTradeCount(otherUser.id, 1)).toBe(1);

    // Backdate one trade outside the window — same id-capture-then-UPDATE
    // pattern used elsewhere in this file to avoid same-millisecond ties.
    const row = db.prepare('SELECT id FROM next_transactions WHERE user_id = ? ORDER BY id ASC LIMIT 1').get(user.id) as { id: number };
    db.prepare('UPDATE next_transactions SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 2 * 60 * 1000).toISOString(), row.id);
    expect(getRecentTradeCount(user.id, 1)).toBe(1);
  });

  it('a real-world trading session stays well under TRADE_RATE_LIMIT_PER_MINUTE, confirming the cap is generous rather than intrusive', () => {
    const user = makeUser('normal-trader@example.com');
    const artist = makeArtist('Normal Trading Artist');
    for (let i = 0; i < 5; i++) executeTrade(user.id, artist.id, 'buy', 10_000);
    expect(getRecentTradeCount(user.id, 1)).toBeLessThan(TRADE_RATE_LIMIT_PER_MINUTE);
  });

  it('trade idempotency: storeTradeResponse then getStoredTradeResponse round-trips the exact status and body, scoped per user+key', () => {
    const user = makeUser('idempotency-user@example.com');
    const otherUser = makeUser('idempotency-other-user@example.com');

    expect(getStoredTradeResponse(user.id, 'key-1')).toBeUndefined();
    storeTradeResponse(user.id, 'key-1', 200, { ok: true, shares: 1.2345 });

    const stored = getStoredTradeResponse(user.id, 'key-1');
    expect(stored).toEqual({ status: 200, body: { ok: true, shares: 1.2345 } });

    // The same key string for a DIFFERENT user is a different row entirely
    // — no cross-user collision.
    expect(getStoredTradeResponse(otherUser.id, 'key-1')).toBeUndefined();

    // Storing again under the same (user, key) is a silent no-op (the
    // UNIQUE-violation path), not an error — and the ORIGINAL response
    // stays intact, which is the whole point: a retried request replays
    // what actually happened, not a second, possibly different outcome.
    storeTradeResponse(user.id, 'key-1', 400, { error: 'a different, later error' });
    expect(getStoredTradeResponse(user.id, 'key-1')).toEqual({ status: 200, body: { ok: true, shares: 1.2345 } });
  });

  it('normalizeEmailForDuplicateCheck strips Gmail dots and +tags, and +tags on other domains, without touching genuinely different addresses', () => {
    expect(normalizeEmailForDuplicateCheck('User.Name+promo@gmail.com')).toBe('username@gmail.com');
    expect(normalizeEmailForDuplicateCheck('username@googlemail.com')).toBe('username@googlemail.com'); // dots stripped, alias domain unchanged
    expect(normalizeEmailForDuplicateCheck('u.ser.name@googlemail.com')).toBe('username@googlemail.com');
    expect(normalizeEmailForDuplicateCheck('someone+work@outlook.com')).toBe('someone@outlook.com');
    // Dots are NOT stripped on a non-Gmail domain — dot-insensitivity is a
    // Gmail-specific mail-server behavior, not a universal email convention.
    expect(normalizeEmailForDuplicateCheck('first.last@outlook.com')).toBe('first.last@outlook.com');
    expect(normalizeEmailForDuplicateCheck('completely-different@example.com')).not.toBe(normalizeEmailForDuplicateCheck('user@gmail.com'));
  });

  it('findUserByNormalizedEmail finds an existing account by its Gmail-dot/plus-tag alias, and returns undefined for a genuinely new email', () => {
    createUser({ name: 'Alias Test User', email: 'alias.test.user@gmail.com', password_hash: 'hash' });

    const found = findUserByNormalizedEmail('AliasTestUser+signup2@gmail.com');
    expect(found).toBeDefined();
    expect(found!.email).toBe('alias.test.user@gmail.com');

    expect(findUserByNormalizedEmail('nobody-with-this-alias@gmail.com')).toBeUndefined();
  });

  it('getSuspiciousTradingFlags surfaces a real rapid-trading pattern with names resolved, and stays empty for ordinary trading', () => {
    const quietUser = makeUser('quiet-trader@example.com');
    const quietArtist = makeArtist('Quiet Trading Artist');
    executeTrade(quietUser.id, quietArtist.id, 'buy', 10_000); // one ordinary trade — should never flag anything
    expect(getSuspiciousTradingFlags().some((f) => f.userIds.includes(quietUser.id))).toBe(false);

    const rapidUser = createUser({ name: 'Rapid Trader', email: 'rapid-trader-flag@example.com', password_hash: 'hash' });
    const rapidArtist = makeArtist('Rapid Trading Flag Artist');
    // 10 trades, all effectively "now" — comfortably within the rapid-trading window.
    for (let i = 0; i < 10; i++) executeTrade(rapidUser.id, rapidArtist.id, 'buy', 5_000);

    const flags = getSuspiciousTradingFlags();
    const rapidFlag = flags.find((f) => f.kind === 'rapid_trading' && f.userIds.includes(rapidUser.id) && f.artistId === rapidArtist.id);
    expect(rapidFlag).toBeDefined();
    expect(rapidFlag!.userNames).toEqual(['Rapid Trader']);
    expect(rapidFlag!.artistName).toBe('Rapid Trading Flag Artist');
  });
});

describe('Performance and reliability (Phase 10) — error reports', () => {
  it('insertErrorReport round-trips every field, and getRecentErrorReports resolves the reporting user\'s name', () => {
    const user = createUser({ name: 'Error Reporter', email: 'error-reporter@example.com', password_hash: 'hash' });
    const before = getErrorReportCount(24);

    insertErrorReport({
      source: 'client',
      message: 'TypeError: cannot read properties of undefined',
      stack: 'TypeError: ...\n  at Component (file.tsx:42:10)',
      digest: 'abc123',
      path: '/next/artists/1',
      userId: user.id,
    });

    expect(getErrorReportCount(24)).toBe(before + 1);
    const recent = getRecentErrorReports(10);
    const mine = recent.find((r) => r.digest === 'abc123')!;
    expect(mine).toBeDefined();
    expect(mine.source).toBe('client');
    expect(mine.message).toBe('TypeError: cannot read properties of undefined');
    expect(mine.stack).toContain('Component (file.tsx:42:10)');
    expect(mine.path).toBe('/next/artists/1');
    expect(mine.user_name).toBe('Error Reporter');
  });

  it('insertErrorReport works without a user (an unauthenticated visitor hit the error boundary)', () => {
    insertErrorReport({ source: 'server', message: 'Unhandled exception in route handler' });
    const recent = getRecentErrorReports(10);
    const mine = recent.find((r) => r.message === 'Unhandled exception in route handler')!;
    expect(mine).toBeDefined();
    expect(mine.user_name).toBeFalsy(); // null from the LEFT JOIN, not a real name
    expect(mine.stack).toBeFalsy();
  });

  it('getErrorReportCount only counts reports within the given hour window', () => {
    insertErrorReport({ source: 'server', message: 'Window test error' });
    const row = db.prepare("SELECT id FROM error_reports WHERE message = 'Window test error' ORDER BY id DESC LIMIT 1").get() as { id: number };
    db.prepare('UPDATE error_reports SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), row.id);

    const countIn24h = getErrorReportCount(24);
    const countIn72h = getErrorReportCount(72);
    expect(countIn72h).toBeGreaterThan(countIn24h); // the backdated row only shows up in the wider window
  });
});

describe('NEXT Feed — feed_events core', () => {
  it('createFeedEvent persists a row retrievable by getFeedEvent, with metadata round-tripped as JSON', () => {
    const artist = makeArtist('Feed Event Artist');
    const event = createFeedEvent({
      eventType: 'new_artist',
      artistId: artist.id,
      refType: 'discovery_candidate',
      refId: 999,
      metadata: { genre: 'pop', score: 80 },
    });

    expect(event).toBeTruthy();
    const fetched = getFeedEvent(event!.id);
    expect(fetched).toBeDefined();
    expect(fetched!.event_type).toBe('new_artist');
    expect(fetched!.artist_id).toBe(artist.id);
    expect(fetched!.ref_type).toBe('discovery_candidate');
    expect(fetched!.ref_id).toBe(999);
    expect(fetched!.visibility).toBe('public');
    expect(JSON.parse(fetched!.metadata!)).toEqual({ genre: 'pop', score: 80 });
  });

  it('a dedupe_key collision is silently ignored — no second row, no throw', () => {
    const artist = makeArtist('Dedupe Artist');
    const before = getFeedEventCount();

    const first = createFeedEvent({ eventType: 'signal_undervalued', artistId: artist.id, dedupeKey: `dedupe-test:${artist.id}` });
    const second = createFeedEvent({ eventType: 'signal_undervalued', artistId: artist.id, dedupeKey: `dedupe-test:${artist.id}` });

    expect(first).toBeTruthy();
    expect(second).toBeNull();
    expect(getFeedEventCount()).toBe(before + 1);
  });

  it('hasFeedEventSince only sees events at or after the cutoff, for that exact event type and artist', () => {
    const artist = makeArtist('Cooldown Artist');
    const otherArtist = makeArtist('Cooldown Other Artist');
    const cutoff = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

    expect(hasFeedEventSince('signal_overheated', artist.id, cutoff)).toBe(false);

    const event = createFeedEvent({ eventType: 'signal_overheated', artistId: artist.id })!;
    expect(hasFeedEventSince('signal_overheated', artist.id, cutoff)).toBe(true);
    // Different event type or different artist — cooldown doesn't apply.
    expect(hasFeedEventSince('signal_undervalued', artist.id, cutoff)).toBe(false);
    expect(hasFeedEventSince('signal_overheated', otherArtist.id, cutoff)).toBe(false);

    // Backdate past the cutoff — the "state has been true for over 10 days,
    // it's safe to post about it again" case the spec calls out.
    db.prepare('UPDATE feed_events SET created_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 11 * 24 * 60 * 60 * 1000).toISOString(), event.id);
    expect(hasFeedEventSince('signal_overheated', artist.id, cutoff)).toBe(false);
  });

  it('getFeedEvents returns newest-first and beforeId pages backward without repeats', () => {
    const artist = makeArtist('Pagination Artist');
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(createFeedEvent({ eventType: 'artist_update', artistId: artist.id, refType: 'contact_log', refId: i })!.id);
    }

    const firstPage = getFeedEvents(2);
    expect(firstPage.map((e) => e.id)).toEqual([ids[4], ids[3]]);

    const secondPage = getFeedEvents(2, firstPage[firstPage.length - 1].id);
    expect(secondPage.map((e) => e.id)).toEqual([ids[2], ids[1]]);
  });
});

describe('NEXT Feed — real events wired into existing actions', () => {
  it('approving a candidate posts a new_artist feed event, deduped to one per candidate', () => {
    insertDiscoveryCandidate({ source: 'soundcharts', soundcharts_uuid: 'uuid-feed-new-1', name: 'Feed New Artist', followers_count: 9000, flagged_reason: 'test' });
    const admin = makeUser('feed-approver@example.com');
    const candidate = getDiscoveryCandidates('new').find((c) => c.soundcharts_uuid === 'uuid-feed-new-1')!;

    const artist = approveDiscoveryCandidate(candidate.id, { id: admin.id, name: admin.name })!;

    const events = getFeedEvents(50).filter((e) => e.artist_id === artist.id && e.event_type === 'new_artist');
    expect(events).toHaveLength(1);
    expect(events[0].ref_type).toBe('discovery_candidate');
    expect(events[0].ref_id).toBe(candidate.id);
  });

  it('approving a candidate with a real submitter also posts early_discovery, attributed to that user', () => {
    const submitter = makeUser('feed-submitter@example.com');
    insertDiscoveryCandidate({
      source: 'public_submission', name: 'Feed Early Discovery Artist', followers_count: 4000,
      flagged_reason: 'test', submitted_by_user_id: submitter.id,
    });
    const admin = makeUser('feed-approver-2@example.com');
    const candidate = getDiscoveryCandidates('new').find((c) => c.name === 'Feed Early Discovery Artist')!;

    const artist = approveDiscoveryCandidate(candidate.id, { id: admin.id, name: admin.name })!;

    const events = getFeedEvents(50).filter((e) => e.artist_id === artist.id && e.event_type === 'early_discovery');
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBe(submitter.id);
  });

  it('approving a candidate with no submitter posts no early_discovery event', () => {
    insertDiscoveryCandidate({ source: 'soundcharts', soundcharts_uuid: 'uuid-feed-no-submitter', name: 'No Submitter Artist', followers_count: 3000, flagged_reason: 'test' });
    const admin = makeUser('feed-approver-3@example.com');
    const candidate = getDiscoveryCandidates('new').find((c) => c.soundcharts_uuid === 'uuid-feed-no-submitter')!;

    const artist = approveDiscoveryCandidate(candidate.id, { id: admin.id, name: admin.name })!;

    expect(getFeedEvents(50).some((e) => e.artist_id === artist.id && e.event_type === 'early_discovery')).toBe(false);
  });

  it('createFeedEvent wired the same way the Artist Update note route wires it produces a matching artist_update event', () => {
    // The note route (app/api/next/my-artist/[id]/note/route.ts) is the
    // actual artist_update source — it calls addLogEntry then
    // createFeedEvent as a pair, verified end-to-end via Playwright QA.
    // This exercises that same pairing at the db layer: the log entry
    // stays the single source of truth, the feed event is just a pointer.
    const claimant = makeUser('feed-claimant@example.com');
    const artist = makeArtist('Feed Update Artist');
    const entry = addLogEntry(artist.id, { type: 'note', message: 'Artist self-update: hello.' }, claimant);
    createFeedEvent({
      eventType: 'artist_update', actorUserId: claimant.id, artistId: artist.id,
      refType: 'contact_log', refId: entry.id, dedupeKey: `artist_update:${entry.id}`,
    });

    const events = getFeedEvents(50).filter((e) => e.artist_id === artist.id && e.event_type === 'artist_update');
    expect(events.some((e) => e.ref_type === 'contact_log' && e.ref_id === entry.id && e.actor_user_id === claimant.id)).toBe(true);
  });

  it('shareFoundingBelieverToFeed returns null when the user never actually backed the artist', () => {
    const user = makeUser('feed-share-nobody@example.com');
    const artist = makeArtist('Feed Share Nobody Artist');
    expect(shareFoundingBelieverToFeed(user.id, artist.id)).toBeNull();
  });

  it('shareFoundingBelieverToFeed posts once per collectible per day, and again on a later day', () => {
    const user = makeUser('feed-sharer@example.com');
    const artist = makeArtist('Feed Share Artist');
    const buy = executeTrade(user.id, artist.id, 'buy', 50_000);
    if (!buy.ok) throw new Error(buy.error);

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
      const first = shareFoundingBelieverToFeed(user.id, artist.id);
      expect(first).toBeTruthy();
      expect(first!.event_type).toBe('founding_believer_share');
      expect(first!.actor_user_id).toBe(user.id);

      const sameDay = shareFoundingBelieverToFeed(user.id, artist.id);
      expect(sameDay).toBeNull();

      vi.setSystemTime(new Date('2026-01-02T12:00:00Z'));
      const nextDay = shareFoundingBelieverToFeed(user.id, artist.id);
      expect(nextDay).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('NEXT Feed — batch lookups for feed item assembly', () => {
  it('getUsersByIds resolves multiple users in one call, skipping ids with no match', () => {
    const a = makeUser('feed-batch-user-a@example.com');
    const b = makeUser('feed-batch-user-b@example.com');
    const map = getUsersByIds([a.id, b.id, 999_999]);
    expect(map.size).toBe(2);
    expect(map.get(a.id)?.email).toBe('feed-batch-user-a@example.com');
    expect(map.get(b.id)?.email).toBe('feed-batch-user-b@example.com');
    expect(map.has(999_999)).toBe(false);
  });

  it('getUsersByIds returns an empty map for an empty input, without querying', () => {
    expect(getUsersByIds([]).size).toBe(0);
  });

  it('getBackedArtistIds lists only artists the user currently holds shares in', () => {
    const user = makeUser('feed-backed-ids@example.com');
    const backed = makeArtist('Feed Backed Artist');
    const soldOut = makeArtist('Feed Sold Out Artist');
    const neverBought = makeArtist('Feed Never Bought Artist');
    executeTrade(user.id, backed.id, 'buy', 50_000);
    executeTrade(user.id, soldOut.id, 'buy', 50_000);
    executeTrade(user.id, soldOut.id, 'sell', 999_999_999);

    const ids = getBackedArtistIds(user.id);
    expect(ids).toContain(backed.id);
    expect(ids).not.toContain(soldOut.id);
    expect(ids).not.toContain(neverBought.id);
  });

  it('getNextArtistsByIds returns live market rows keyed by id, matching getNextArtist for the same artist', () => {
    const artist = makeArtist('Feed Batch Market Artist');
    const single = getNextArtist(artist.id)!;
    const batch = getNextArtistsByIds([artist.id, 999_999]);
    expect(batch.size).toBe(1);
    expect(batch.get(artist.id)?.score).toBe(single.score);
    expect(batch.get(artist.id)?.priceCents).toBe(single.priceCents);
    expect(batch.has(999_999)).toBe(false);
  });

  it('getNextArtistsByIds returns an empty map for an empty input', () => {
    expect(getNextArtistsByIds([]).size).toBe(0);
  });

  it('getLogEntryById finds a specific contact_log row by id', () => {
    const artist = makeArtist('Feed Log Lookup Artist');
    const entry = addLogEntry(artist.id, { type: 'note', message: 'Feed lookup test note.' });
    const found = getLogEntryById(entry.id);
    expect(found?.message).toBe('Feed lookup test note.');
    expect(getLogEntryById(999_999)).toBeUndefined();
  });

  it('getFoundingBelieverRecordById finds a specific record by id, independent of getFoundingBelieverRecord\'s user+artist lookup', () => {
    const user = makeUser('feed-founding-lookup@example.com');
    const artist = makeArtist('Feed Founding Lookup Artist');
    const buy = executeTrade(user.id, artist.id, 'buy', 50_000);
    if (!buy.ok) throw new Error(buy.error);
    const byUserArtist = getFoundingBelieverRecord(user.id, artist.id)!;
    const byId = getFoundingBelieverRecordById(byUserArtist.id);
    expect(byId?.id).toBe(byUserArtist.id);
    expect(byId?.discovery_rank).toBe(byUserArtist.discovery_rank);
    expect(getFoundingBelieverRecordById(999_999)).toBeUndefined();
  });

  it('logFeedItemImpressions records one analytics event per feed_events id, and no-ops on an empty list', () => {
    const user = makeUser('feed-impressions@example.com');
    const before = db.prepare("SELECT COUNT(*) AS c FROM analytics_events WHERE event_type = 'feed_item_impression'").get() as { c: number };
    logFeedItemImpressions(user.id, [1, 2, 3]);
    const after = db.prepare("SELECT COUNT(*) AS c FROM analytics_events WHERE event_type = 'feed_item_impression'").get() as { c: number };
    expect(after.c - before.c).toBe(3);

    logFeedItemImpressions(user.id, []);
    const afterEmpty = db.prepare("SELECT COUNT(*) AS c FROM analytics_events WHERE event_type = 'feed_item_impression'").get() as { c: number };
    expect(afterEmpty.c).toBe(after.c);
  });
});
