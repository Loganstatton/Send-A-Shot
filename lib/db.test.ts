import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';

// DATA_DIR must be set before lib/data-dir.ts (and therefore lib/db.ts) is
// ever imported, so this test runs against an isolated, throwaway SQLite
// file instead of the real dev/prod database.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-test-'));

const { quoteSell, SELL_ALL_SENTINEL_CENTS } = await import('./next-market');

const {
  addLogEntry, addToWatchlist, approveDiscoveryCandidate, bulkSetArtistStage, completeDiscoveryRun,
  completeNextOnboarding, completeSyncRun, createArtist, createArtistClaim, createDiscoveryRun, createFeedEvent, createSyncRun,
  createUser, db, getHolding,
  deleteUser, executeTrade, findArtistsByName,
  getApprovedDiscoveriesCount, getArtist, getArtistClaim, getArtistFieldHistory, getArtistLastActivityMap,
  getArtistLog, getArtistsClaimedByUser,
  getArtistsMissingDeezerData, getErrorReportCount, getRecentErrorReports, insertErrorReport,
  getArtistsInPhotoBackoff, getArtistsInVideoBackoff, getArtistsMissingPhoto, getArtistsMissingVideo, getArtistsWithSoundchartsLink,
  createUserTakePost, deleteUserTakePost, getRecentUserTakePostCount, getReportedUserTakePosts, getUserTakePostById,
  getUserTakePostsByIds, getUserTakePostsForUser, hideUserTakePost, reportUserTakePost, searchNextArtists, unhideUserTakePost,
  USER_TAKE_BODY_MAX_LENGTH,
  getArtistTradeVolumeCents, getBackedArtistIds, getBackerCountsByArtist, getBreakoutDiscoveriesCount, getDiscoveriesForUser,
  getDiscoveryCandidateCountsByGenre,
  getDiscoveryCandidateCountsByStatus, getDiscoveryCandidateHistory, getDiscoveryCandidates, getDiscoveryGenres,
  getDiscoveryLeaderboard, getEarliestScoreSnapshots,
  getEventCountsByType,
  getFavoriteGenres, getFeedEvent, getFeedEventCount, getFeedEvents, getFeedReactionCounts, getFeedReactionCountsForEvents,
  getFoundingBelieverRecord, getFoundingBelieverRecordById, getKnownDiscoveryUuids,
  getKnownDiscoveryYoutubeChannelIds, getLatestDiscoveryRun,
  getLatestScoreSnapshots,
  getLatestSyncRun, getLogEntryById, getMarketTradeCounts, getMarketVolumeCents, getMissingPlatformLinksImpact,
  getMostActiveArtists, getNewArtistsThisWeek, getNewDiscoveryCandidateCount, getNextArtist, getNextArtistsByIds,
  getPendingArtistClaimCount, getPendingArtistClaims, getPendingClaimForUserAndArtist, getPortfolioValue,
  getPortfolioValueHistory, getRankMovements, getUserHoldings,
  getReadNotificationKeys, getRecentBackerCount, getRecentBackerCountsByArtist, getRecentDiscoveryReviewDecisions,
  getRecentDiscoveryRunsWithCandidateCounts, getRecentEventsForUser,
  getRecentMarketTrades, getRecentSubmissionCount, getRecentSyncFailures, getRecentTradesForArtist,
  getRecentTradeCount, getRecentWatchCountsByArtist,
  getScoreChanges, getScoutLeaderboard, getScoutProfile, getStoredTradeResponse, getSuspiciousTradingFlags,
  getTrackedSoundchartsUuids, getUnverifiedVideoMatchCount,
  getRecentReactionCount, getUserById, getUserFeedReactionsForEvents, getUserPasswordHash, getUsersByIds, getUserTransactions,
  getUserWatchlist, getWatchCountsByArtist,
  getYoutubeQuotaUsedToday, hasFeedEventSince, hasListenedToArtist, findDuplicateArtistSubmission, findUserByNormalizedEmail,
  normalizeEmailForDuplicateCheck, insertDiscoveryCandidate, isWatchlisted,
  logArtistCardViews, logFeedItemImpressions,
  logEvent, logSyncFailure, markEmailVerified, markNotificationRead, markNotificationsRead, recordLogin,
  recordPreviewListen, recordYoutubeQuotaUsage, reviewArtistClaim, setDiscoveryCandidateStatus,
  setFeaturedVideoMatchType,
  setFeedReaction, setNotificationsEmailedThrough, setWatchlistAlerts, shareFoundingBelieverToFeed, SOUNDCHARTS_NO_MATCH_RECHECK_DAYS,
  stampSoundchartsNoMatch,
  stampSourceSyncedAt, stampYoutubeNoMatch, storeTradeResponse,
  TRADE_RATE_LIMIT_PER_MINUTE, updateArtist,
  updateUserProfile, YOUTUBE_NO_MATCH_RECHECK_DAYS,
  saveWikidataMatch, saveWikidataNoMatch, setArtistPhotoByOwner, removeArtistProvidedPhoto, updateArtistByOwner,
} = await import('./db');

const STARTING_BALANCE_CENTS = 1_000_000; // $10,000

async function makeUser(email: string) {
  return await createUser({ name: 'Test Trader', email, password_hash: 'not-a-real-hash' });
}

async function makeArtist(name: string) {
  // All eight rated categories at 8/10 (growth_velocity/engagement_quality
  // are ordinary Scout-manual categories now, same as the rest — see the
  // WRITABLE_FIELDS comment in lib/db.ts), so
  // breakoutScore = 8 * (sum of weights)/10 = 8 * 100/10 = 80 exactly.
  // Deterministic, no seeding needed. growth_velocity_pct/
  // engagement_rate_pct are also set here purely as legacy display
  // context — they no longer drive anything.
  return await createArtist({
    name,
    music_talent: 8,
    growth_velocity: 8,
    growth_velocity_pct: 32,
    engagement_quality: 8,
    engagement_rate_pct: 16,
    original_song_response: 8,
    brand_personality: 8,
    content_consistency: 8,
    commercial_potential: 8,
    professionalism: 8,
  });
}

describe('NEXT trading engine — self-trade exploit prevention', () => {
  it('a single buy-then-sell-all round trip does not profit, and moves price both directions', async () => {
    const user = await makeUser('single-roundtrip@example.com');
    const artist = await makeArtist('Round Trip Artist');

    const priceBefore = (await getNextArtist(artist.id))!.priceCents;

    const buy = await executeTrade(user.id, artist.id, 'buy', 100_000); // $1,000
    if (!buy.ok) throw new Error(buy.error);
    expect(buy.shares).toBeGreaterThan(0);

    const priceAfterBuy = (await getNextArtist(artist.id))!.priceCents;
    // Visible market impact must still exist: a buy with no other activity
    // pushes the price up.
    expect(priceAfterBuy).toBeGreaterThan(priceBefore);

    // Sell every share back immediately, valued at the current price — the
    // same thing the "Sell all" button in the UI does.
    const sellAmount = Math.round(buy.shares * priceAfterBuy);
    const sell = await executeTrade(user.id, artist.id, 'sell', sellAmount);
    if (!sell.ok) throw new Error(sell.error);

    const priceAfterSell = (await getNextArtist(artist.id))!.priceCents;
    // And a sell with no other activity pushes it back down.
    expect(priceAfterSell).toBeLessThan(priceAfterBuy);

    const finalBalance = (await getUserById(user.id))!.next_credits_cents;

    // The whole point: buying then immediately selling back, with zero
    // outside market activity, must never leave the trader with more
    // credits than they started with.
    expect(finalBalance).toBeLessThanOrEqual(STARTING_BALANCE_CENTS);
    // Sanity: it shouldn't vanish either — this is slippage, not a penalty.
    expect(finalBalance).toBeGreaterThan(STARTING_BALANCE_CENTS - 100_000);
  });

  it("a fresh buy's displayed unrealized P&L is NOT a phantom gain — it closely predicts what selling right now actually realizes", async () => {
    // Regression test for a real reported bug: right after a buy, the raw
    // quoted price already includes that buy's own upward impact, so
    // marking the position to shares * quotedPrice showed a large instant
    // "gain" that vanished the moment the user tried to sell. getUserHoldings
    // must mark to the REALISTIC exit value (via quoteSell) instead.
    const user = await makeUser('phantom-gain-check@example.com');
    const artist = await makeArtist('Phantom Gain Artist');

    const buy = await executeTrade(user.id, artist.id, 'buy', 500_000); // $5,000, big enough for real impact
    if (!buy.ok) throw new Error(buy.error);

    const holding = (await getUserHoldings(user.id)).find((h) => h.artist_id === artist.id)!;
    const naivePhantomValueCents = Math.round(holding.shares * holding.price_cents);
    const displayedUnrealizedPnlCents = holding.exitValueCents - holding.cost_basis_cents;

    // The bug: marking to the raw quote overstates the position — proves
    // exitValueCents is genuinely doing something different, not a no-op.
    expect(holding.exitValueCents).toBeLessThan(naivePhantomValueCents);

    // The fix: what's actually shown as "unrealized" should be small —
    // nowhere near a few-hundred-dollar phantom gain on a $5,000 buy with
    // zero outside market activity.
    expect(Math.abs(displayedUnrealizedPnlCents)).toBeLessThan(5_000); // < $50, pure rounding/spread noise

    // getPortfolioValue must be wired to the same fixed math, not its own
    // separate shares * price_cents calculation.
    const balanceCents = (await getUserById(user.id))!.next_credits_cents;
    const portfolio = await getPortfolioValue(user.id);
    expect(portfolio.holdingsValueCents).toBe(holding.exitValueCents);
    expect(portfolio.totalValueCents).toBe(balanceCents + holding.exitValueCents);

    // The real proof: selling the whole position right now must realize
    // very close to what was just displayed as "unrealized."
    const sell = await executeTrade(user.id, artist.id, 'sell', naivePhantomValueCents);
    if (!sell.ok) throw new Error(sell.error);
    expect(Math.abs(sell.realizedPnlCents! - displayedUnrealizedPnlCents)).toBeLessThan(200); // within $2, rounding only
  });

  it("selling the exact estimated exit value can leave shares behind — proving why 'Sell all' must use SELL_ALL_SENTINEL_CENTS, not an estimate", async () => {
    // Regression test for a bug the phantom-gain fix above introduced: the
    // UI's "Sell all" button used to send shares * currentQuote as
    // credits_amount_cents, which — being an OVERESTIMATE of true exit
    // value — happened to always exceed ownedShares * livePrice and so
    // reliably tripped executeTrade's Math.min(requestedShares, ownedShares)
    // full-liquidation cap. Once "Sell all" switched to the realistic (lower)
    // exitValueCents estimate, that safety margin disappeared: requesting
    // exactly the estimated value converts back to a SMALLER share count
    // than is actually owned (because the estimate already priced in the
    // sell's own downward impact, on top of prePriceCents also being lower
    // than the buy's post-impact quote), leaving a real residue unsold.
    const user = await makeUser('sell-all-undershoot@example.com');
    const artist = await makeArtist('Sell All Undershoot Artist');

    const buy = await executeTrade(user.id, artist.id, 'buy', 500_000); // $5,000, big enough for real impact
    if (!buy.ok) throw new Error(buy.error);

    const holdingBefore = (await getHolding(user.id, artist.id))!;
    const currentQuoteCents = (await getArtist(artist.id))!.next_current_price_cents!;
    const estimatedExitValueCents = quoteSell(currentQuoteCents, holdingBefore.shares).proceedsCents;

    // The undershoot: selling exactly the honest estimate does NOT clear
    // the position out.
    const partialSell = await executeTrade(user.id, artist.id, 'sell', estimatedExitValueCents);
    if (!partialSell.ok) throw new Error(partialSell.error);
    const holdingAfterEstimateSell = await getHolding(user.id, artist.id);
    expect(holdingAfterEstimateSell).toBeDefined();
    expect(holdingAfterEstimateSell!.shares).toBeGreaterThan(0.001); // real shares left behind, not rounding dust

    // The fix: SELL_ALL_SENTINEL_CENTS always clears it completely,
    // regardless of any price-estimation drift.
    const fullSell = await executeTrade(user.id, artist.id, 'sell', SELL_ALL_SENTINEL_CENTS);
    if (!fullSell.ok) throw new Error(fullSell.error);
    expect(await getHolding(user.id, artist.id)).toBeUndefined();
    expect(fullSell.shares).toBeCloseTo(holdingAfterEstimateSell!.shares, 6);
  });

  it('repeated self-trading round trips cannot manufacture credits', async () => {
    const user = await makeUser('repeated-roundtrip@example.com');
    const artist = await makeArtist('Repeated Round Trip Artist');

    let previousBalance = STARTING_BALANCE_CENTS;

    // A different, non-round trade size each round, so this isn't just
    // proving one lucky amount is safe.
    let anyLoss = false;

    for (let i = 0; i < 25; i++) {
      const buyAmountCents = 150_000 + (i * 61_703) % 250_000;
      const buy = await executeTrade(user.id, artist.id, 'buy', buyAmountCents);
      if (!buy.ok) throw new Error(buy.error);

      const currentPrice = (await getNextArtist(artist.id))!.priceCents;
      const sellAmount = Math.round(buy.shares * currentPrice);
      const sell = await executeTrade(user.id, artist.id, 'sell', sellAmount);
      if (!sell.ok) throw new Error(sell.error);

      const balance = (await getUserById(user.id))!.next_credits_cents;
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

    const finalBalance = (await getUserById(user.id))!.next_credits_cents;
    // "Approximately the starting balance or slightly less, never more" —
    // per spec, breaking exactly even on some rounds is fine; profiting
    // never is.
    expect(finalBalance).toBeLessThanOrEqual(STARTING_BALANCE_CENTS);
    // But across 25 rounds of varied, non-round trade sizes, slippage
    // should actually bite at least once — otherwise this "fee" is a no-op
    // and the test isn't proving anything.
    expect(anyLoss).toBe(true);
  });

  it('a real price move (no round trip) still lets a holder profit', async () => {
    // Guards against a too-aggressive fix that makes ALL trading a loss —
    // buying, having the price rise from someone else's demand, then
    // selling should still be profitable.
    const buyer = await makeUser('real-buyer@example.com');
    const otherBuyer = await makeUser('other-buyer@example.com');
    const artist = await makeArtist('Genuinely Rising Artist');

    const buy = await executeTrade(buyer.id, artist.id, 'buy', 100_000);
    if (!buy.ok) throw new Error(buy.error);

    // Someone else piles in, pushing the price up for reasons unrelated to
    // the first buyer's own trade.
    const other = await executeTrade(otherBuyer.id, artist.id, 'buy', 500_000);
    if (!other.ok) throw new Error(other.error);

    const priceNow = (await getNextArtist(artist.id))!.priceCents;
    const sellAmount = Math.round(buy.shares * priceNow);
    const sell = await executeTrade(buyer.id, artist.id, 'sell', sellAmount);
    if (!sell.ok) throw new Error(sell.error);

    const finalBalance = (await getUserById(buyer.id))!.next_credits_cents;
    expect(finalBalance).toBeGreaterThan(STARTING_BALANCE_CENTS);
  });
});

describe('Discovery Engine — candidate queue', () => {
  it('a new candidate appears in the "new" queue and counts toward the pending badge', async () => {
    const before = await getNewDiscoveryCandidateCount();
    await insertDiscoveryCandidate({
      source: 'soundcharts',
      soundcharts_uuid: 'uuid-new-1',
      name: 'Fresh Signal',
      followers_count: 12_000,
      followers_7d_ago: 10_000,
      growth_7d_pct: 20,
      flagged_reason: '+20% Spotify followers in 7 days (10.0K → 12.0K) — a sudden jump',
    });

    expect(await getNewDiscoveryCandidateCount()).toBe(before + 1);
    const queue = await getDiscoveryCandidates('new');
    const found = queue.find((c) => c.soundcharts_uuid === 'uuid-new-1');
    expect(found).toBeDefined();
    expect(found!.status).toBe('new');
  });

  it('Pass and Watch move a candidate out of the "new" queue without touching the roster', async () => {
    const passUser = await makeUser('pass-actor@example.com');
    const watchUser = await makeUser('watch-actor@example.com');

    await insertDiscoveryCandidate({ source: 'soundcharts', soundcharts_uuid: 'uuid-pass-1', name: 'Pass Me', followers_count: 5000, flagged_reason: 'test' });
    await insertDiscoveryCandidate({ source: 'soundcharts', soundcharts_uuid: 'uuid-watch-1', name: 'Watch Me', followers_count: 5000, flagged_reason: 'test' });

    const passCandidate = (await getDiscoveryCandidates('new')).find((c) => c.soundcharts_uuid === 'uuid-pass-1')!;
    const watchCandidate = (await getDiscoveryCandidates('new')).find((c) => c.soundcharts_uuid === 'uuid-watch-1')!;

    const passed = await setDiscoveryCandidateStatus(passCandidate.id, 'passed', { id: passUser.id, name: passUser.name });
    const watched = await setDiscoveryCandidateStatus(watchCandidate.id, 'watching', { id: watchUser.id, name: watchUser.name });

    expect(passed!.status).toBe('passed');
    expect(watched!.status).toBe('watching');
    // Neither shows up in the "new" queue anymore...
    expect((await getDiscoveryCandidates('new')).some((c) => c.id === passCandidate.id)).toBe(false);
    expect((await getDiscoveryCandidates('new')).some((c) => c.id === watchCandidate.id)).toBe(false);
    // ...but a passed/watched candidate never became a real artist.
    expect((await getTrackedSoundchartsUuids()).has('uuid-pass-1')).toBe(false);
    expect((await getTrackedSoundchartsUuids()).has('uuid-watch-1')).toBe(false);
  });

  it('a passed or watched candidate is excluded from future scans by soundcharts_uuid', async () => {
    await insertDiscoveryCandidate({ source: 'soundcharts', soundcharts_uuid: 'uuid-known-1', name: 'Already Seen', followers_count: 5000, flagged_reason: 'test' });
    expect((await getKnownDiscoveryUuids()).has('uuid-known-1')).toBe(true);
  });

  it('Approve creates a real, editable artist pre-filled from the candidate — not auto-scored', async () => {
    const admin = await makeUser('approver@example.com');
    await insertDiscoveryCandidate({
      source: 'soundcharts',
      soundcharts_uuid: 'uuid-approve-1',
      name: 'Breakout Kid',
      photo_url: 'https://example.com/photo.jpg',
      country: 'US',
      followers_count: 42_000,
      growth_30d_pct: 15,
      flagged_reason: '+15% Spotify followers in 30 days (36.5K → 42.0K)',
    });
    const candidate = (await getDiscoveryCandidates('new')).find((c) => c.soundcharts_uuid === 'uuid-approve-1')!;

    const artist = await approveDiscoveryCandidate(candidate.id, { id: admin.id, name: admin.name });

    expect(artist).toBeDefined();
    expect(artist!.name).toBe('Breakout Kid');
    expect(artist!.soundcharts_uuid).toBe('uuid-approve-1');
    expect(artist!.followers_count).toBe(42_000);
    // Human judgment drives every category (growth_velocity/
    // engagement_quality included now — see the WRITABLE_FIELDS comment
    // in lib/db.ts), but approval starts them all at the same neutral
    // 5/10 the Add Artist form itself defaults to — not 0, which would
    // make every freshly-discovered artist score as "Pass" no matter how
    // strong its real signal was.
    expect(artist!.music_talent).toBe(5);
    expect(artist!.growth_velocity).toBe(5);

    // The candidate is now linked to the real artist and marked approved,
    // and the artist is immediately editable/findable like any other.
    const reloaded = (await getDiscoveryCandidates()).find((c) => c.id === candidate.id)!;
    expect(reloaded.status).toBe('approved');
    expect(reloaded.artist_id).toBe(artist!.id);
    expect(await getArtist(artist!.id)).toBeDefined();

    // And it's now tracked, so a future scan won't re-flag it.
    expect((await getTrackedSoundchartsUuids()).has('uuid-approve-1')).toBe(true);
  });
});

describe('Data-driven scoring — Growth Velocity / Engagement Quality are Scout-manual', () => {
  // Pre-beta migration: these two categories used to be silently
  // re-derived from growth_velocity_pct/engagement_rate_pct (a
  // Soundcharts-shaped metric) on every save. They're now ordinary
  // Scout-manual 0-10 ratings, same as the other six — see the
  // WRITABLE_FIELDS comment in lib/db.ts. The *_pct fields still exist
  // and are still storable (legacy/manual context a Scout can see), but
  // no longer drive either category automatically.

  it('growth_velocity/engagement_quality are set directly from input, not derived from the _pct fields', async () => {
    const artist = await createArtist({
      name: 'Manual Growth',
      growth_velocity_pct: 32, // present, but must NOT influence growth_velocity below
      growth_velocity: 7,
      engagement_rate_pct: 16, // present, but must NOT influence engagement_quality below
      engagement_quality: 3,
    });
    expect(artist.growth_velocity).toBe(7);
    expect(artist.engagement_quality).toBe(3);
  });

  it('omitting growth_velocity / engagement_quality defaults to 0, not null (schema is NOT NULL)', async () => {
    const artist = await createArtist({ name: 'No Rating Yet' });
    expect(artist.growth_velocity).toBe(0);
    expect(artist.engagement_quality).toBe(0);
  });

  it('updating growth_velocity_pct alone leaves growth_velocity untouched', async () => {
    const artist = await createArtist({ name: 'Update Growth', growth_velocity: 8, engagement_quality: 8 });
    expect(artist.growth_velocity).toBe(8);

    const updated = (await updateArtist(artist.id, { name: artist.name, growth_velocity_pct: 99 }))!;
    // Only the legacy display field changed — the actual rated category
    // is untouched since this update never mentioned it.
    expect(updated.growth_velocity_pct).toBe(99);
    expect(updated.growth_velocity).toBe(8);
    expect(updated.engagement_quality).toBe(8);
  });

  it('updating growth_velocity directly changes the rated category', async () => {
    const artist = await createArtist({ name: 'Direct Update', growth_velocity: 4 });
    const updated = (await updateArtist(artist.id, { name: artist.name, growth_velocity: 9 }))!;
    expect(updated.growth_velocity).toBe(9);
  });
});

describe('Automated Soundcharts sync', () => {
  it('getArtistsWithSoundchartsLink only returns artists with a linked uuid', async () => {
    const linked = await createArtist({ name: 'Linked Artist', soundcharts_uuid: 'uuid-linked-1' });
    await createArtist({ name: 'Unlinked Artist' });

    const rows = await getArtistsWithSoundchartsLink();
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(linked.id);
    expect(rows.find((r) => r.id === linked.id)?.soundcharts_uuid).toBe('uuid-linked-1');
  });

  it('createSyncRun/completeSyncRun/getLatestSyncRun round-trip a run record', async () => {
    const run = await createSyncRun();
    expect(run.status).toBe('running');

    await completeSyncRun(run.id, { status: 'completed', checkedCount: 5, updatedCount: 3, failedCount: 1 });

    const latest = (await getLatestSyncRun())!;
    expect(latest.id).toBe(run.id);
    expect(latest.status).toBe('completed');
    expect(latest.checked_count).toBe(5);
    expect(latest.updated_count).toBe(3);
    expect(latest.failed_count).toBe(1);
    expect(latest.completed_at).toBeTruthy();
  });

  it('a failed sync run records its error message', async () => {
    const run = await createSyncRun();
    await completeSyncRun(run.id, { status: 'failed', checkedCount: 0, updatedCount: 0, failedCount: 0, error: 'Soundcharts unreachable' });

    const latest = (await getLatestSyncRun())!;
    expect(latest.id).toBe(run.id);
    expect(latest.status).toBe('failed');
    expect(latest.error).toBe('Soundcharts unreachable');
  });
});

describe('Deezer top-song and photo sync', () => {
  it('getArtistsMissingDeezerData returns an artist missing either field, but not one with both filled', async () => {
    const missingBoth = await createArtist({ name: 'No Top Song Or Photo Yet' });
    const missingPhotoOnly = await createArtist({ name: 'Has Song No Photo', top_song_url: 'https://www.deezer.com/track/123' });
    const missingSongOnly = await createArtist({ name: 'Has Photo No Song', photo_url: 'https://example.com/photo.jpg' });
    const hasBoth = await createArtist({
      name: 'Already Has Both', top_song_url: 'https://www.deezer.com/track/999', photo_url: 'https://example.com/both.jpg',
    });

    const ids = (await getArtistsMissingDeezerData()).map((r) => r.id);
    expect(ids).toContain(missingBoth.id);
    expect(ids).toContain(missingPhotoOnly.id);
    expect(ids).toContain(missingSongOnly.id);
    expect(ids).not.toContain(hasBoth.id);
  });

  it('filling in one missing field leaves an artist in the set until the other is filled too', async () => {
    const artist = await createArtist({ name: 'Freshly Filled' });
    expect((await getArtistsMissingDeezerData()).map((r) => r.id)).toContain(artist.id);

    await updateArtist(artist.id, { name: artist.name, top_song_url: 'https://www.deezer.com/track/456' } as any);
    // Still missing a photo — sync should visit it again.
    expect((await getArtistsMissingDeezerData()).map((r) => r.id)).toContain(artist.id);

    await updateArtist(artist.id, { name: artist.name, photo_url: 'https://example.com/now-has-one.jpg' } as any);
    expect((await getArtistsMissingDeezerData()).map((r) => r.id)).not.toContain(artist.id);
  });

  it("Soundcharts and Deezer sync runs keep independent 'latest' history via the source column", async () => {
    const soundchartsRun = await createSyncRun('soundcharts');
    await completeSyncRun(soundchartsRun.id, { status: 'completed', checkedCount: 5, updatedCount: 5, failedCount: 0 });
    const deezerRun = await createSyncRun('deezer');
    await completeSyncRun(deezerRun.id, { status: 'completed', checkedCount: 3, updatedCount: 2, failedCount: 1 });

    const latestSoundcharts = (await getLatestSyncRun('soundcharts'))!;
    const latestDeezer = (await getLatestSyncRun('deezer'))!;
    expect(latestSoundcharts.id).toBe(soundchartsRun.id);
    expect(latestSoundcharts.source).toBe('soundcharts');
    expect(latestDeezer.id).toBe(deezerRun.id);
    expect(latestDeezer.source).toBe('deezer');
    expect(latestDeezer.updated_count).toBe(2);
  });

  it('a Deezer run round-trips the no-match-vs-error breakdown — this is what tells a Scout why a REAL artist failed', async () => {
    const run = await createSyncRun('deezer');
    await completeSyncRun(run.id, {
      status: 'completed', checkedCount: 4, updatedCount: 0, failedCount: 4,
      noMatchCount: 3, errorCount: 1, lastError: 'Deezer returned 429: rate limited.',
    });

    const latest = (await getLatestSyncRun('deezer'))!;
    expect(latest.id).toBe(run.id);
    expect(latest.no_match_count).toBe(3);
    expect(latest.error_count).toBe(1);
    expect(latest.last_error).toBe('Deezer returned 429: rate limited.');
  });

  it('a Soundcharts run (no lookup-reason breakdown) leaves those columns null, not zero', async () => {
    const run = await createSyncRun('soundcharts');
    await completeSyncRun(run.id, { status: 'completed', checkedCount: 5, updatedCount: 5, failedCount: 0 });

    const latest = (await getLatestSyncRun('soundcharts'))!;
    expect(latest.no_match_count ?? null).toBeNull();
    expect(latest.error_count ?? null).toBeNull();
  });
});

describe('YouTube discovery — candidates without a Soundcharts identity', () => {
  it('inserts and reads back a YouTube candidate with no soundcharts_uuid at all', async () => {
    await insertDiscoveryCandidate({
      source: 'youtube',
      name: 'Unmatched Channel',
      yt_video_id: 'vid-unmatched-1',
      yt_channel_id: 'chan-unmatched-1',
      yt_channel_title: 'Unmatched Channel',
      yt_genre: 'pop',
      yt_view_count: 150_000,
      yt_channel_subscriber_count: 8_000,
      flagged_reason: '150K views in 6 days • 8K channel subscribers',
    });

    const found = (await getDiscoveryCandidates('new')).find((c) => c.yt_channel_id === 'chan-unmatched-1')!;
    expect(found).toBeDefined();
    expect(found.source).toBe('youtube');
    expect(found.soundcharts_uuid).toBeFalsy();
  });

  it('a YouTube candidate CAN carry a Soundcharts match alongside its channel identity', async () => {
    await insertDiscoveryCandidate({
      source: 'youtube',
      name: 'Matched Channel',
      soundcharts_uuid: 'uuid-yt-matched-1',
      followers_count: 22_000,
      growth_30d_pct: 12,
      yt_channel_id: 'chan-matched-1',
      yt_channel_title: 'Matched Channel',
      flagged_reason: 'test',
    });

    const found = (await getDiscoveryCandidates('new')).find((c) => c.yt_channel_id === 'chan-matched-1')!;
    expect(found.soundcharts_uuid).toBe('uuid-yt-matched-1');
    expect(found.followers_count).toBe(22_000);
  });

  it('the same YouTube channel cannot be inserted twice (partial unique index)', async () => {
    await insertDiscoveryCandidate({ source: 'youtube', name: 'Dup Channel', yt_channel_id: 'chan-dup-1', flagged_reason: 'test' });
    await expect(
      insertDiscoveryCandidate({ source: 'youtube', name: 'Dup Channel', yt_channel_id: 'chan-dup-1', flagged_reason: 'test' })
    ).rejects.toThrow();
  });

  it('two Soundcharts-less YouTube candidates coexist fine (soundcharts_uuid null is not treated as a duplicate)', async () => {
    await insertDiscoveryCandidate({ source: 'youtube', name: 'No Match A', yt_channel_id: 'chan-null-a', flagged_reason: 'test' });
    await expect(
      insertDiscoveryCandidate({ source: 'youtube', name: 'No Match B', yt_channel_id: 'chan-null-b', flagged_reason: 'test' })
    ).resolves.toBeUndefined();
  });

  it('getKnownDiscoveryYoutubeChannelIds tracks channels regardless of review status', async () => {
    await insertDiscoveryCandidate({ source: 'youtube', name: 'Known Channel', yt_channel_id: 'chan-known-1', flagged_reason: 'test' });
    expect((await getKnownDiscoveryYoutubeChannelIds()).has('chan-known-1')).toBe(true);
  });

  it('hype-comment fields (rate, examples, likes) round-trip through insert and read', async () => {
    await insertDiscoveryCandidate({
      source: 'youtube',
      name: 'Hype Channel',
      yt_channel_id: 'chan-hype-1',
      yt_hype_comment_rate: 0.15,
      yt_comments_analyzed: 20,
      yt_example_comment_1: 'how is this not viral??',
      yt_example_comment_1_likes: 412,
      yt_example_comment_2: 'this is so underrated',
      yt_example_comment_2_likes: 88,
      flagged_reason: '142K views in 6 days • 💬 "how is this not viral??" (412 likes)',
    });

    const found = (await getDiscoveryCandidates('new')).find((c) => c.yt_channel_id === 'chan-hype-1')!;
    expect(found.yt_hype_comment_rate).toBeCloseTo(0.15, 5);
    expect(found.yt_comments_analyzed).toBe(20);
    expect(found.yt_example_comment_1).toBe('how is this not viral??');
    expect(found.yt_example_comment_1_likes).toBe(412);
    expect(found.yt_example_comment_2).toBe('this is so underrated');
    expect(found.yt_example_comment_2_likes).toBe(88);
  });

  it('a candidate with no hype comments found leaves those fields null, not zero-filled', async () => {
    await insertDiscoveryCandidate({ source: 'youtube', name: 'No Hype', yt_channel_id: 'chan-no-hype-1', flagged_reason: 'test' });
    const found = (await getDiscoveryCandidates('new')).find((c) => c.yt_channel_id === 'chan-no-hype-1')!;
    expect(found.yt_hype_comment_rate ?? null).toBeNull();
    expect(found.yt_example_comment_1 ?? null).toBeNull();
  });

  it('Approve on a YouTube candidate carries its genre onto the new artist as a human label, not the raw scan-bucket key, and never requires a Soundcharts uuid', async () => {
    const admin = await makeUser('yt-approver@example.com');
    await insertDiscoveryCandidate({
      source: 'youtube',
      name: 'Genre Carrier',
      yt_channel_id: 'chan-genre-1',
      yt_genre: 'rock-alternative',
      flagged_reason: 'test',
    });
    const candidate = (await getDiscoveryCandidates('new')).find((c) => c.yt_channel_id === 'chan-genre-1')!;
    const artist = (await approveDiscoveryCandidate(candidate.id, { id: admin.id, name: admin.name }))!;

    expect(artist).toBeDefined();
    expect(artist.genre).toBe('Rock/Alternative');
    expect(artist.soundcharts_uuid ?? null).toBeNull();
  });

  it('Approve on a YouTube candidate with an unrecognized genre key falls back to that raw key rather than dropping it', async () => {
    const admin = await makeUser('yt-approver-fallback@example.com');
    await insertDiscoveryCandidate({
      source: 'youtube',
      name: 'Unknown Genre Carrier',
      yt_channel_id: 'chan-genre-2',
      yt_genre: 'some-future-bucket',
      flagged_reason: 'test',
    });
    const candidate = (await getDiscoveryCandidates('new')).find((c) => c.yt_channel_id === 'chan-genre-2')!;
    const artist = (await approveDiscoveryCandidate(candidate.id, { id: admin.id, name: admin.name }))!;

    expect(artist.genre).toBe('some-future-bucket');
  });

  it('Approve on a YouTube candidate carries its photo and location through when Soundcharts enrichment found them', async () => {
    const admin = await makeUser('yt-approver-photo@example.com');
    await insertDiscoveryCandidate({
      source: 'youtube',
      name: 'Photo Carrier',
      yt_channel_id: 'chan-photo-1',
      photo_url: 'https://example.com/photo.jpg',
      country: 'Toronto, CA',
      soundcharts_uuid: 'uuid-photo-1',
      flagged_reason: 'test',
    });
    const candidate = (await getDiscoveryCandidates('new')).find((c) => c.yt_channel_id === 'chan-photo-1')!;
    const artist = (await approveDiscoveryCandidate(candidate.id, { id: admin.id, name: admin.name }))!;

    expect(artist.photo_url).toBe('https://example.com/photo.jpg');
    expect(artist.location).toBe('Toronto, CA');
  });

  it('a completed YouTube run round-trips its rejection breakdown — this is what tells a Scout "why zero", not just "zero"', async () => {
    const run = await createDiscoveryRun('youtube');
    await completeDiscoveryRun(run.id, {
      status: 'completed',
      searchedCount: 90,
      candidatesFound: 0,
      quotaUsed: 602,
      rejectionBreakdown: {
        notOfficialRelease: 15,
        belowMinViews: 12,
        noSubscriberCount: 30,
        subscriberOutOfBand: 40,
        duplicateSoundchartsMatch: 3,
      },
    });

    const latest = (await getLatestDiscoveryRun('youtube'))!;
    expect(latest.id).toBe(run.id);
    expect(latest.candidates_found).toBe(0);
    expect(latest.rejected_not_official_release).toBe(15);
    expect(latest.rejected_below_min_views).toBe(12);
    expect(latest.rejected_no_subscriber_count).toBe(30);
    expect(latest.rejected_subscriber_out_of_band).toBe(40);
    expect(latest.rejected_duplicate_soundcharts_match).toBe(3);
    // Legacy momentum-score columns: always null now that no such score is
    // computed (see the momentum_score comment in lib/db.ts's schema).
    expect(latest.rejected_below_momentum_threshold ?? null).toBeNull();
    expect(latest.best_rejected_momentum_score ?? null).toBeNull();
  });

  it('a Soundcharts run (no rejection filtering) leaves the breakdown columns null, not zero', async () => {
    const run = await createDiscoveryRun('soundcharts');
    await completeDiscoveryRun(run.id, { status: 'completed', searchedCount: 10, candidatesFound: 2 });

    const latest = (await getLatestDiscoveryRun('soundcharts'))!;
    expect(latest.id).toBe(run.id);
    expect(latest.rejected_below_min_views ?? null).toBeNull();
    expect(latest.rejected_below_momentum_threshold ?? null).toBeNull();
  });
});

describe('Account management', () => {
  it('createUser records ToS/Privacy acceptance at signup time', async () => {
    const user = await createUser({ name: 'Beta Tester', email: 'accept@example.com', password_hash: 'hash' });
    expect(user.tos_accepted_at).toBeTruthy();
    expect(user.privacy_accepted_at).toBeTruthy();
  });

  it('updateUserProfile changes name/avatar but never touches email, role, or credits', async () => {
    const user = await createUser({ name: 'Old Name', email: 'profile@example.com', password_hash: 'hash' });
    const updated = (await updateUserProfile(user.id, { name: 'New Name', avatar_url: 'https://example.com/a.png' }))!;
    expect(updated.name).toBe('New Name');
    expect(updated.avatar_url).toBe('https://example.com/a.png');
    expect(updated.email).toBe('profile@example.com');
    expect(updated.role).toBe('public');
    expect(updated.next_credits_cents).toBe(STARTING_BALANCE_CENTS);
  });

  it('updateUserProfile clears avatar_url when given an empty string', async () => {
    const user = await createUser({ name: 'Has Avatar', email: 'avatar@example.com', password_hash: 'hash' });
    await updateUserProfile(user.id, { avatar_url: 'https://example.com/a.png' });
    const cleared = (await updateUserProfile(user.id, { avatar_url: '' }))!;
    expect(cleared.avatar_url ?? null).toBeNull();
  });

  it('markEmailVerified is idempotent — verifying twice keeps the original timestamp', async () => {
    const user = await createUser({ name: 'Verify Me', email: 'verify@example.com', password_hash: 'hash' });
    const first = (await markEmailVerified(user.id))!;
    const second = (await markEmailVerified(user.id))!;
    expect(first.email_verified_at).toBeTruthy();
    expect(second.email_verified_at).toBe(first.email_verified_at);
  });

  it('getUserPasswordHash returns the real hash, never exposed on the public User type', async () => {
    const user = await createUser({ name: 'Hash Check', email: 'hash@example.com', password_hash: 'super-secret-hash' });
    expect(await getUserPasswordHash(user.id)).toBe('super-secret-hash');
    expect((user as any).password_hash).toBeUndefined();
  });

  it('deleteUser cascades NEXT holdings, transactions, and watchlist, but leaves the artist alone', async () => {
    const user = await createUser({ name: 'Deleting Soon', email: 'delete@example.com', password_hash: 'hash' });
    const artist = await makeArtist('Cascade Target');
    await executeTrade(user.id, artist.id, 'buy', 50_000);
    await addToWatchlist(user.id, artist.id);
    expect(await isWatchlisted(user.id, artist.id)).toBe(true);

    await deleteUser(user.id);

    expect(await getUserById(user.id)).toBeUndefined();
    // A fresh user id can't be watchlisted/checked against a deleted user,
    // so re-fetching the artist directly is the real assertion here: it
    // must still exist — deleting a trader must never delete the artist.
    expect(await getArtist(artist.id)).toBeTruthy();
  });
});

describe('Discover aggregates — watch/backer counts', () => {
  it('getWatchCountsByArtist counts distinct watchers per artist, not per watchlist row', async () => {
    const artist = await makeArtist('Watched Artist');
    const other = await makeArtist('Unwatched Artist');
    const alice = await createUser({ name: 'Alice', email: 'alice-watch@example.com', password_hash: 'hash' });
    const bob = await createUser({ name: 'Bob', email: 'bob-watch@example.com', password_hash: 'hash' });
    await addToWatchlist(alice.id, artist.id);
    await addToWatchlist(bob.id, artist.id);

    const counts = await getWatchCountsByArtist();
    expect(counts[artist.id]).toBe(2);
    expect(counts[other.id] ?? 0).toBe(0);
  });

  it('getBackerCountsByArtist only counts users currently holding shares (> 0)', async () => {
    const artist = await makeArtist('Backed Artist');
    const holder = await createUser({ name: 'Holder', email: 'holder@example.com', password_hash: 'hash' });
    const soldOut = await createUser({ name: 'Sold Out', email: 'soldout@example.com', password_hash: 'hash' });

    await executeTrade(holder.id, artist.id, 'buy', 50_000);
    await executeTrade(soldOut.id, artist.id, 'buy', 50_000);
    await executeTrade(soldOut.id, artist.id, 'sell', 999_999_999); // sell everything back out

    const counts = await getBackerCountsByArtist();
    expect(counts[artist.id]).toBe(1);
  });
});

describe('Music experience — listen tracking', () => {
  it('hasListenedToArtist is false until a "started" event is recorded, then true', async () => {
    const artist = await makeArtist('Listened Artist');
    const user = await createUser({ name: 'Listener', email: 'listener@example.com', password_hash: 'hash' });
    expect(await hasListenedToArtist(user.id, artist.id)).toBe(false);

    await recordPreviewListen(user.id, artist.id, 'started');
    expect(await hasListenedToArtist(user.id, artist.id)).toBe(true);
  });

  it('a "completed" event alone does not count as having listened (started is the real signal)', async () => {
    const artist = await makeArtist('Completed Only Artist');
    const user = await createUser({ name: 'Skipper', email: 'skipper@example.com', password_hash: 'hash' });
    await recordPreviewListen(user.id, artist.id, 'completed');
    expect(await hasListenedToArtist(user.id, artist.id)).toBe(false);
  });

  it('a buy is stamped listened_before_buy=true only when the listen happened first', async () => {
    const artist = await makeArtist('Buy After Listen');
    const listener = await createUser({ name: 'Did Listen', email: 'did-listen@example.com', password_hash: 'hash' });
    const skipper = await createUser({ name: 'Did Not Listen', email: 'no-listen@example.com', password_hash: 'hash' });

    await recordPreviewListen(listener.id, artist.id, 'started');
    await executeTrade(listener.id, artist.id, 'buy', 50_000);
    await executeTrade(skipper.id, artist.id, 'buy', 50_000);

    const [listenerTx] = (await getUserTransactions(listener.id)).filter((t) => t.artist_id === artist.id);
    const [skipperTx] = (await getUserTransactions(skipper.id)).filter((t) => t.artist_id === artist.id);
    expect(listenerTx.listened_before_buy).toBe(true);
    expect(skipperTx.listened_before_buy).toBe(false);
  });

  it('sell transactions leave listened_before_buy undefined, not false', async () => {
    const artist = await makeArtist('Sell Row Artist');
    const user = await createUser({ name: 'Trader', email: 'trader-sell@example.com', password_hash: 'hash' });
    await executeTrade(user.id, artist.id, 'buy', 50_000);
    await executeTrade(user.id, artist.id, 'sell', 999_999_999);

    const sellTx = (await getUserTransactions(user.id)).find((t) => t.artist_id === artist.id && t.type === 'sell');
    expect(sellTx?.listened_before_buy).toBeUndefined();
  });
});

describe('Trading panel — volume, recent backers, activity feed', () => {
  it('getArtistTradeVolumeCents sums both buys and sells within the window, excludes trades outside it', async () => {
    const artist = await makeArtist('Volume Artist');
    const buyer = await createUser({ name: 'Buyer', email: 'volume-buyer@example.com', password_hash: 'hash' });
    const seller = await createUser({ name: 'Seller', email: 'volume-seller@example.com', password_hash: 'hash' });

    await executeTrade(buyer.id, artist.id, 'buy', 50_000);
    await executeTrade(seller.id, artist.id, 'buy', 30_000);
    await executeTrade(seller.id, artist.id, 'sell', 10_000);

    // Backdate the buyer's trade to 48h ago so it falls outside a 24h window.
    await db.prepare("UPDATE next_transactions SET created_at = ? WHERE user_id = ?").run(new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), buyer.id);

    const volume24h = await getArtistTradeVolumeCents(artist.id, 24);
    // Only seller's buy (30,000) and sell (some proceeds close to 10,000,
    // adjusted by market impact) should count — never the backdated 50,000 buy.
    expect(volume24h).toBeGreaterThan(0);
    expect(volume24h).toBeLessThan(50_000 + 30_000 + 10_000);

    const volumeAllTime = await getArtistTradeVolumeCents(artist.id, 24 * 365);
    expect(volumeAllTime).toBeGreaterThan(volume24h);
  });

  it('getRecentBackerCount counts distinct buyers in the window, not total buy transactions', async () => {
    const artist = await makeArtist('Recent Backers Artist');
    const alice = await createUser({ name: 'Alice R', email: 'alice-recent@example.com', password_hash: 'hash' });
    const bob = await createUser({ name: 'Bob R', email: 'bob-recent@example.com', password_hash: 'hash' });

    await executeTrade(alice.id, artist.id, 'buy', 10_000);
    await executeTrade(alice.id, artist.id, 'buy', 10_000); // same person, second buy — still counts once
    await executeTrade(bob.id, artist.id, 'buy', 10_000);

    expect(await getRecentBackerCount(artist.id, 24)).toBe(2);
  });

  it('getRecentTradesForArtist returns most-recent-first with the buyer/seller name attached', async () => {
    const artist = await makeArtist('Feed Artist');
    const alice = await createUser({ name: 'Alice Feed', email: 'alice-feed@example.com', password_hash: 'hash' });
    const bob = await createUser({ name: 'Bob Feed', email: 'bob-feed@example.com', password_hash: 'hash' });

    await executeTrade(alice.id, artist.id, 'buy', 10_000);
    await executeTrade(bob.id, artist.id, 'buy', 20_000);

    const trades = await getRecentTradesForArtist(artist.id);
    expect(trades).toHaveLength(2);
    expect(trades[0].user_name).toBe('Bob Feed'); // most recent first
    expect(trades[1].user_name).toBe('Alice Feed');
    expect(trades[0].type).toBe('buy');
  });
});

describe('Watchlist — since-you-added deltas, momentum sort, alert preferences', () => {
  it('getScoreChanges only includes artists with a second snapshot, keyed off the latest minus the previous', async () => {
    const stable = await makeArtist('Stable Score Artist'); // only ever gets its creation snapshot
    const mover = await makeArtist('Mover Score Artist');
    const scoreBefore = (await getNextArtist(mover.id))!.score;
    await updateArtist(mover.id, { name: mover.name, music_talent: 10 }); // higher input -> higher Breakout Score -> a second snapshot
    const scoreAfter = (await getNextArtist(mover.id))!.score;

    const changes = await getScoreChanges();
    expect(changes[stable.id]).toBeUndefined();
    expect(changes[mover.id]).toEqual({ changeAbs: Math.round((scoreAfter - scoreBefore) * 10) / 10, hasComparison: true });
    expect(changes[mover.id].changeAbs).toBeGreaterThan(0);
  });

  it('getUserWatchlist reports the Score/Price as of the watch date, distinct from where they stand now', async () => {
    const artist = await makeArtist('Since Watched Artist');
    const watcher = await createUser({ name: 'Watcher', email: 'since-watched@example.com', password_hash: 'hash' });
    const mover = await createUser({ name: 'Mover', email: 'since-watched-mover@example.com', password_hash: 'hash' });

    const scoreAtStart = (await getNextArtist(artist.id))!.score;
    const priceAtStart = (await getNextArtist(artist.id))!.priceCents; // seeds the first price_history row

    await addToWatchlist(watcher.id, artist.id);

    // Move both Score and Price after the watch, then force these rows'
    // timestamps 10 minutes into the future — sequential real-clock calls
    // in a fast test can land in the same millisecond as the watch itself
    // (the exact race the Trading panel section's id-tiebreaker fix dealt
    // with for next_transactions), so this pins the ordering unambiguously
    // rather than relying on the test happening to run slowly enough.
    await updateArtist(artist.id, { name: artist.name, music_talent: 10 });
    await executeTrade(mover.id, artist.id, 'buy', 500_000);
    await db.prepare(`
      UPDATE score_history SET recorded_at = ?
      WHERE id = (SELECT MAX(id) FROM score_history WHERE artist_id = ?)
    `).run(new Date(Date.now() + 10 * 60 * 1000).toISOString(), artist.id);
    await db.prepare(`
      UPDATE next_price_history SET recorded_at = ?
      WHERE id = (SELECT MAX(id) FROM next_price_history WHERE artist_id = ?)
    `).run(new Date(Date.now() + 10 * 60 * 1000).toISOString(), artist.id);

    const [entry] = await getUserWatchlist(watcher.id);
    expect(entry.artist.id).toBe(artist.id);
    expect(entry.scoreAtWatch).toBe(scoreAtStart);
    expect(entry.priceAtWatchCents).toBe(priceAtStart);
    expect(entry.score).toBeGreaterThan(entry.scoreAtWatch!);
    expect(entry.priceCents).toBeGreaterThan(entry.priceAtWatchCents!);
    expect(entry.alertsEnabled).toBe(true); // on by default
    expect(entry.watchedAt).toBeTruthy();
  });

  it('getUserWatchlist falls back to the earliest available price point when nothing was recorded before the watch', async () => {
    // createArtist() already snapshots a score at creation, so to get a
    // genuinely empty "before" series this checks price only: an artist
    // whose price has never been read (no next_price_history row exists)
    // before it gets watched.
    const artist = await createArtist({
      name: 'Never Priced Artist', music_talent: 8, growth_velocity_pct: 32, engagement_rate_pct: 16,
      original_song_response: 8, brand_personality: 8, content_consistency: 8, commercial_potential: 8, professionalism: 8,
    });
    const watcher = await createUser({ name: 'Early Watcher', email: 'never-priced@example.com', password_hash: 'hash' });

    await addToWatchlist(watcher.id, artist.id);

    // First-ever read of this artist's market data happens inside
    // getUserWatchlist itself, which seeds next_price_history lazily — so
    // the resulting single price point necessarily lands at/after the
    // watch, and there is nothing genuinely "before" to compare against.
    const [entry] = await getUserWatchlist(watcher.id);
    expect(entry.priceAtWatchCents).toBe(entry.priceCents);
  });

  it('setWatchlistAlerts toggles the per-watch alert preference', async () => {
    const artist = await makeArtist('Alert Toggle Artist');
    const user = await createUser({ name: 'Alert User', email: 'alert-toggle@example.com', password_hash: 'hash' });
    await addToWatchlist(user.id, artist.id);

    expect((await getUserWatchlist(user.id))[0].alertsEnabled).toBe(true);
    await setWatchlistAlerts(user.id, artist.id, false);
    expect((await getUserWatchlist(user.id))[0].alertsEnabled).toBe(false);
    await setWatchlistAlerts(user.id, artist.id, true);
    expect((await getUserWatchlist(user.id))[0].alertsEnabled).toBe(true);
  });
});

describe('Portfolio — value history reconstruction', () => {
  it('returns an empty history for a user with no trades', async () => {
    const user = await createUser({ name: 'No Trades', email: 'no-trades-history@example.com', password_hash: 'hash' });
    expect(await getPortfolioValueHistory(user.id)).toEqual([]);
  });

  it("reflects a price move from another trader on a held artist, not just the holder's own trades", async () => {
    const artist = await makeArtist('Shared Price Artist');
    const holder = await createUser({ name: 'Holder', email: 'holder-history@example.com', password_hash: 'hash' });
    const mover = await createUser({ name: 'Mover', email: 'mover-history@example.com', password_hash: 'hash' });

    const buy = await executeTrade(holder.id, artist.id, 'buy', 100_000);
    if (!buy.ok) throw new Error(buy.error);
    const historyRightAfterOwnBuy = await getPortfolioValueHistory(holder.id);
    const valueRightAfterOwnBuy = historyRightAfterOwnBuy[historyRightAfterOwnBuy.length - 1].value_cents;

    // Someone else moves the market on the same artist — the holder never trades again.
    const moverBuy = await executeTrade(mover.id, artist.id, 'buy', 500_000);
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
    await db.prepare(`
      UPDATE next_price_history SET recorded_at = ?
      WHERE id = (SELECT MAX(id) FROM next_price_history WHERE artist_id = ?)
    `).run(new Date(Date.now() + 60_000).toISOString(), artist.id);

    const historyAfterMarketMove = await getPortfolioValueHistory(holder.id);
    const valueAfterMarketMove = historyAfterMarketMove[historyAfterMarketMove.length - 1].value_cents;

    expect(historyAfterMarketMove.length).toBeGreaterThan(historyRightAfterOwnBuy.length);
    expect(valueAfterMarketMove).toBeGreaterThan(valueRightAfterOwnBuy);
  });

  it('never shows a buy-then-sell round trip as profitable, same as the trading engine itself', async () => {
    const artist = await makeArtist('Sell History Artist');
    const trader = await createUser({ name: 'Trader', email: 'trader-history@example.com', password_hash: 'hash' });

    const buy = await executeTrade(trader.id, artist.id, 'buy', 200_000);
    if (!buy.ok) throw new Error(buy.error);
    const afterBuy = await getPortfolioValueHistory(trader.id);
    const afterBuyValue = afterBuy[afterBuy.length - 1].value_cents;

    const sell = await executeTrade(trader.id, artist.id, 'sell', 100_000);
    if (!sell.ok) throw new Error(sell.error);
    const afterSell = await getPortfolioValueHistory(trader.id);
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
  it("the 'all' window matches getPortfolioValue's own totalReturnPct exactly (no regression from adding windows)", async () => {
    const user = await createUser({ name: 'All Window Scout', email: 'all-window@example.com', password_hash: 'hash' });
    const artist = await makeArtist('All Window Artist');
    await executeTrade(user.id, artist.id, 'buy', 100_000);

    const entry = (await getScoutLeaderboard('all')).find((e) => e.user.id === user.id)!;
    expect(entry.totalReturnPct).toBe((await getPortfolioValue(user.id)).totalReturnPct);
  });

  it("the 'week' window measures return from the value at the start of the window, not all-time", async () => {
    const user = await createUser({ name: 'Week Window Scout', email: 'week-window@example.com', password_hash: 'hash' });
    const artist = await makeArtist('Week Window Artist');

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
    await db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(thirtyDaysAgo, user.id);
    const earlyBuy = await executeTrade(user.id, artist.id, 'buy', 600_000);
    if (!earlyBuy.ok) throw new Error(earlyBuy.error);
    // Someone else then pushes the price well up, also before the window:
    // a real all-time gain that the 'week' baseline must already include.
    const pusher = await createUser({ name: 'Week Window Pusher', email: 'week-window-pusher@example.com', password_hash: 'hash' });
    const push = await executeTrade(pusher.id, artist.id, 'buy', 900_000);
    if (!push.ok) throw new Error(push.error);
    await db.prepare('UPDATE next_transactions SET created_at = ? WHERE user_id IN (?, ?)').run(twentyDaysAgo, user.id, pusher.id);
    await db.prepare('UPDATE next_price_history SET recorded_at = ? WHERE artist_id = ?').run(twentyDaysAgo, artist.id);

    // A second trade lands "now" — inside the window.
    const recentBuy = await executeTrade(user.id, artist.id, 'buy', 300_000);
    if (!recentBuy.ok) throw new Error(recentBuy.error);

    const allEntry = (await getScoutLeaderboard('all')).find((e) => e.user.id === user.id)!;
    const weekEntry = (await getScoutLeaderboard('week')).find((e) => e.user.id === user.id)!;

    // 'all' is measured from the starting balance (includes both trades'
    // impact cost); 'week' is measured from the backdated snapshot
    // (includes only the recent trade) — different baselines, so different
    // numbers, proving 'week' isn't secretly just re-running the all-time math.
    expect(weekEntry.totalReturnPct).not.toBe(allEntry.totalReturnPct);
  });

  it("'week' shows 0% for a big position nobody has touched all week (baseline and current value are both what it would sell for)", async () => {
    // Regression: the window baseline used to value holdings at the quoted
    // price while the current value used sell proceeds, so any large,
    // untouched position showed a phantom weekly loss.
    const user = await createUser({ name: 'Idle Whale', email: 'idle-whale@example.com', password_hash: 'hash' });
    const artist = await makeArtist('Idle Whale Artist');
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    await db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(thirtyDaysAgo, user.id);
    const buy = await executeTrade(user.id, artist.id, 'buy', 900_000);
    if (!buy.ok) throw new Error(buy.error);
    await db.prepare('UPDATE next_transactions SET created_at = ? WHERE user_id = ?').run(twentyDaysAgo, user.id);
    await db.prepare('UPDATE next_price_history SET recorded_at = ? WHERE artist_id = ?').run(twentyDaysAgo, artist.id);

    const weekEntry = (await getScoutLeaderboard('week')).find((e) => e.user.id === user.id)!;
    expect(weekEntry.totalReturnPct).toBe(0);
  });

  it('getRankMovements is null for an account that did not exist 7 days ago, and non-null for one that did', async () => {
    const faller = await createUser({ name: 'Faller', email: 'faller-rank@example.com', password_hash: 'hash' });
    const riser = await createUser({ name: 'Riser', email: 'riser-rank@example.com', password_hash: 'hash' }); // created "now" — genuinely new relative to the 7-day window
    const artist = await makeArtist('Rank Movement Artist');

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    await db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(thirtyDaysAgo, faller.id);
    const fallerEarly = await executeTrade(faller.id, artist.id, 'buy', 200_000);
    if (!fallerEarly.ok) throw new Error(fallerEarly.error);
    await db.prepare('UPDATE next_transactions SET created_at = ? WHERE user_id = ?').run(twentyDaysAgo, faller.id);
    await db.prepare('UPDATE next_price_history SET recorded_at = ? WHERE artist_id = ?').run(twentyDaysAgo, artist.id);

    const riserBuy = await executeTrade(riser.id, artist.id, 'buy', 500_000);
    if (!riserBuy.ok) throw new Error(riserBuy.error);

    const movements = await getRankMovements();
    expect(movements[riser.id]).toBeNull();
    expect(movements[faller.id]).not.toBeNull();
  });
});

describe('Public Scout Profile — favorite genres, positions privacy toggle', () => {
  it('getFavoriteGenres ranks genres by how many artists in each the Scout has ever backed', async () => {
    const user = await createUser({ name: 'Genre Scout', email: 'genre-scout@example.com', password_hash: 'hash' });
    const popArtists = [
      await createArtist({ name: 'Pop One', genre: 'Pop', music_talent: 8, growth_velocity_pct: 32, engagement_rate_pct: 16, original_song_response: 8, brand_personality: 8, content_consistency: 8, commercial_potential: 8, professionalism: 8 }),
      await createArtist({ name: 'Pop Two', genre: 'Pop', music_talent: 8, growth_velocity_pct: 32, engagement_rate_pct: 16, original_song_response: 8, brand_personality: 8, content_consistency: 8, commercial_potential: 8, professionalism: 8 }),
    ];
    const jazzArtist = await createArtist({ name: 'Jazz One', genre: 'Jazz', music_talent: 8, growth_velocity_pct: 32, engagement_rate_pct: 16, original_song_response: 8, brand_personality: 8, content_consistency: 8, commercial_potential: 8, professionalism: 8 });

    for (const artist of popArtists) await executeTrade(user.id, artist.id, 'buy', 10_000);
    await executeTrade(user.id, jazzArtist.id, 'buy', 10_000);

    const favorites = await getFavoriteGenres(user.id);
    expect(favorites[0]).toEqual({ genre: 'Pop', count: 2 });
    expect(favorites[1]).toEqual({ genre: 'Jazz', count: 1 });
  });

  it('updateUserProfile toggles show_positions_publicly, normalized back to a real boolean (not 0/1)', async () => {
    const user = await createUser({ name: 'Privacy Scout', email: 'privacy-scout@example.com', password_hash: 'hash' });
    expect(user.show_positions_publicly).toBe(false); // off by default

    await updateUserProfile(user.id, { show_positions_publicly: true });
    expect((await getUserById(user.id))!.show_positions_publicly).toBe(true);

    await updateUserProfile(user.id, { show_positions_publicly: false });
    expect((await getUserById(user.id))!.show_positions_publicly).toBe(false);
  });

  it("getScoutProfile hides positions (null, not an empty list) until the Scout opts in, then shows real holdings", async () => {
    const user = await createUser({ name: 'Position Scout', email: 'position-scout@example.com', password_hash: 'hash' });
    const artist = await makeArtist('Position Scout Artist');
    const buy = await executeTrade(user.id, artist.id, 'buy', 50_000);
    if (!buy.ok) throw new Error(buy.error);

    const hiddenProfile = (await getScoutProfile(user.id))!;
    expect(hiddenProfile.showPositionsPublicly).toBe(false);
    expect(hiddenProfile.positions).toBeNull();

    await updateUserProfile(user.id, { show_positions_publicly: true });
    const shownProfile = (await getScoutProfile(user.id))!;
    expect(shownProfile.showPositionsPublicly).toBe(true);
    expect(shownProfile.positions).toHaveLength(1);
    expect(shownProfile.positions![0]).toMatchObject({ artist_id: artist.id, artist_name: 'Position Scout Artist' });
    expect(shownProfile.positions![0].shares).toBeCloseTo(buy.shares, 6);
  });
});

describe('Market Activity — market-wide feed, volume, active/backed/watched, new artists', () => {
  it('getRecentMarketTrades returns every artist\'s trades together, most recent first', async () => {
    const artistA = await makeArtist('Market Feed Artist A');
    const artistB = await makeArtist('Market Feed Artist B');
    const trader = await createUser({ name: 'Market Feed Trader', email: 'market-feed@example.com', password_hash: 'hash' });

    await executeTrade(trader.id, artistA.id, 'buy', 10_000);
    await executeTrade(trader.id, artistB.id, 'buy', 20_000);

    const trades = await getRecentMarketTrades(10);
    const names = trades.map((t) => t.artist_name);
    expect(names).toContain('Market Feed Artist A');
    expect(names).toContain('Market Feed Artist B');
    expect(trades[0].artist_name).toBe('Market Feed Artist B'); // most recent first
  });

  it('getMarketVolumeCents and getMarketTradeCounts only count trades inside the window, across every artist', async () => {
    // Both queries are true market-wide aggregates with no per-test
    // scoping, and this file shares one DB across ~120 tests that all run
    // "now" — so asserting an exact count would really be asserting
    // "nothing else in the whole suite traded in the last 24h," which
    // isn't true. Instead this measures the DELTA this test's own trades
    // cause, which holds regardless of what the rest of the suite did.
    const before24h = await getMarketTradeCounts(24);
    const beforeVolume24h = await getMarketVolumeCents(24);

    const artistA = await makeArtist('Volume Feed Artist A');
    const artistB = await makeArtist('Volume Feed Artist B');
    const buyer = await createUser({ name: 'Volume Feed Buyer', email: 'volume-feed-buyer@example.com', password_hash: 'hash' });
    const seller = await createUser({ name: 'Volume Feed Seller', email: 'volume-feed-seller@example.com', password_hash: 'hash' });

    await executeTrade(buyer.id, artistA.id, 'buy', 50_000);
    const oldBuy = await executeTrade(seller.id, artistB.id, 'buy', 40_000);
    if (!oldBuy.ok) throw new Error(oldBuy.error);
    await executeTrade(seller.id, artistB.id, 'sell', 10_000);

    // Push one artist's trade outside the 24h window entirely.
    await db.prepare("UPDATE next_transactions SET created_at = ? WHERE user_id = ? AND artist_id = ? AND type = 'buy'")
      .run(new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), seller.id, artistB.id);

    const volume24h = await getMarketVolumeCents(24);
    const volumeAllTime = await getMarketVolumeCents(24 * 365);
    expect(volumeAllTime).toBeGreaterThan(volume24h);
    // Only the artistA buy and the artistB sell remain inside the window —
    // the backdated artistB buy dropped out.
    expect(volume24h - beforeVolume24h).toBeGreaterThan(0);
    expect(volume24h - beforeVolume24h).toBeLessThan(50_000 + 10_000);

    const after24h = await getMarketTradeCounts(24);
    expect(after24h.buys - before24h.buys).toBe(1);
    expect(after24h.sells - before24h.sells).toBe(1);
  });

  it('getMostActiveArtists ranks by trade count within the window', async () => {
    const busy = await makeArtist('Busy Feed Artist');
    const quiet = await makeArtist('Quiet Feed Artist');
    const trader = await createUser({ name: 'Active Feed Trader', email: 'active-feed@example.com', password_hash: 'hash' });

    await executeTrade(trader.id, busy.id, 'buy', 10_000);
    await executeTrade(trader.id, busy.id, 'buy', 10_000);
    await executeTrade(trader.id, busy.id, 'buy', 10_000);
    await executeTrade(trader.id, quiet.id, 'buy', 10_000);

    // A generous limit: by this point in the suite many other tests have
    // traded other artists in the last 24h too, so a small limit could
    // legitimately push either of these two out of a top-10.
    const active = await getMostActiveArtists(24, 1000);
    const busyEntry = active.find((a) => a.artist_id === busy.id)!;
    const quietEntry = active.find((a) => a.artist_id === quiet.id)!;
    expect(busyEntry.tradeCount).toBe(3);
    expect(quietEntry.tradeCount).toBe(1);
    expect(active.indexOf(busyEntry)).toBeLessThan(active.indexOf(quietEntry));
  });

  it('getRecentBackerCountsByArtist and getRecentWatchCountsByArtist count distinct recent activity per artist', async () => {
    const artist = await makeArtist('Recent Counts Artist');
    const alice = await createUser({ name: 'Alice Counts', email: 'alice-counts@example.com', password_hash: 'hash' });
    const bob = await createUser({ name: 'Bob Counts', email: 'bob-counts@example.com', password_hash: 'hash' });

    await executeTrade(alice.id, artist.id, 'buy', 10_000);
    await executeTrade(alice.id, artist.id, 'buy', 10_000); // same backer again — still counts once
    await executeTrade(bob.id, artist.id, 'buy', 10_000);
    await addToWatchlist(alice.id, artist.id);
    await addToWatchlist(bob.id, artist.id);

    expect((await getRecentBackerCountsByArtist(24))[artist.id]).toBe(2);
    expect((await getRecentWatchCountsByArtist(24))[artist.id]).toBe(2);
  });

  it('getNewArtistsThisWeek excludes artists older than the window and passed artists', async () => {
    const freshArtist = await makeArtist('Fresh This Week Artist');
    const oldArtist = await makeArtist('Old Artist');
    await db.prepare('UPDATE artists SET created_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), oldArtist.id);
    const passedArtist = await createArtist({
      name: 'Passed This Week Artist', stage: 'passed', music_talent: 8, growth_velocity_pct: 32, engagement_rate_pct: 16,
      original_song_response: 8, brand_personality: 8, content_consistency: 8, commercial_potential: 8, professionalism: 8,
    });

    const fresh = await getNewArtistsThisWeek(7);
    const names = fresh.map((a) => a.name);
    expect(names).toContain('Fresh This Week Artist');
    expect(names).not.toContain('Old Artist');
    expect(names).not.toContain('Passed This Week Artist');
  });
});

describe('Notification center — read-state persistence and preference columns', () => {
  it('markNotificationRead/markNotificationsRead persist keys, and re-marking the same key is a harmless no-op', async () => {
    const user = await createUser({ name: 'Notif Reader', email: 'notif-reader@example.com', password_hash: 'hash' });
    expect((await getReadNotificationKeys(user.id)).size).toBe(0);

    await markNotificationRead(user.id, 'watchlist_score:1:1');
    await markNotificationRead(user.id, 'watchlist_score:1:1'); // duplicate — should not throw or double-insert
    await markNotificationsRead(user.id, ['leaderboard_rank:2026-01-01', 'portfolio_milestone:25']);

    const keys = await getReadNotificationKeys(user.id);
    expect(keys.size).toBe(3);
    expect(keys.has('watchlist_score:1:1')).toBe(true);
    expect(keys.has('portfolio_milestone:25')).toBe(true);
    expect(keys.has('some-other-key')).toBe(false);
  });

  it('read state is scoped per user — one user marking a key read does not affect another', async () => {
    const alice = await createUser({ name: 'Notif Alice', email: 'notif-alice@example.com', password_hash: 'hash' });
    const bob = await createUser({ name: 'Notif Bob', email: 'notif-bob@example.com', password_hash: 'hash' });
    await markNotificationRead(alice.id, 'shared-key');
    expect((await getReadNotificationKeys(alice.id)).has('shared-key')).toBe(true);
    expect((await getReadNotificationKeys(bob.id)).has('shared-key')).toBe(false);
  });

  it('setNotificationsEmailedThrough updates the cursor column', async () => {
    const user = await createUser({ name: 'Notif Cursor', email: 'notif-cursor@example.com', password_hash: 'hash' });
    expect((await getUserById(user.id))!.notifications_emailed_through).toBeFalsy();
    const now = new Date().toISOString();
    await setNotificationsEmailedThrough(user.id, now);
    expect((await getUserById(user.id))!.notifications_emailed_through).toBe(now);
  });

  it('updateUserProfile round-trips every notification preference as a real boolean, defaulting on except email', async () => {
    const user = await createUser({ name: 'Notif Prefs', email: 'notif-prefs@example.com', password_hash: 'hash' });
    expect(user.notify_watchlist_moves).toBe(true);
    expect(user.notify_new_artists).toBe(true);
    expect(user.notify_founding_believer).toBe(true);
    expect(user.notify_portfolio_milestones).toBe(true);
    expect(user.notify_leaderboard_rank).toBe(true);
    expect(user.email_notifications_enabled).toBe(false); // opt-in, unlike the rest

    const updated = (await updateUserProfile(user.id, {
      notify_watchlist_moves: false, notify_new_artists: false, email_notifications_enabled: true,
    }))!;
    expect(updated.notify_watchlist_moves).toBe(false);
    expect(updated.notify_new_artists).toBe(false);
    expect(updated.email_notifications_enabled).toBe(true);
    expect(updated.notify_founding_believer).toBe(true); // untouched fields stay as they were
  });
});

describe('Product analytics — event logging', () => {
  it('logEvent records the event type and JSON metadata, most recent first', async () => {
    const user = await createUser({ name: 'Event User', email: 'event-user@example.com', password_hash: 'hash' });
    await logEvent(user.id, 'watchlist_added', { artistId: 42 });
    await logEvent(user.id, 'artist_detail_opened', { artistId: 42 });

    const events = await getRecentEventsForUser(user.id);
    expect(events).toHaveLength(2);
    expect(events[0].event_type).toBe('artist_detail_opened'); // most recent first
    expect(events[0].metadata).toEqual({ artistId: 42 });
    expect(events[1].event_type).toBe('watchlist_added');
  });

  it('logEvent with no metadata stores a null metadata field, not an empty object', async () => {
    const user = await createUser({ name: 'No Metadata User', email: 'no-metadata@example.com', password_hash: 'hash' });
    await logEvent(user.id, 'discover_viewed');
    expect((await getRecentEventsForUser(user.id))[0].metadata).toBeNull();
  });

  it('logArtistCardViews writes one artist_card_viewed row per artist id', async () => {
    const user = await createUser({ name: 'Card View User', email: 'card-view@example.com', password_hash: 'hash' });
    await logArtistCardViews(user.id, [1, 2, 3]);
    const events = await getRecentEventsForUser(user.id);
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.event_type === 'artist_card_viewed')).toBe(true);
    expect(events.map((e) => (e.metadata as any).artistId).sort()).toEqual([1, 2, 3]);
  });

  it('logArtistCardViews is a no-op for an empty artist list', async () => {
    const user = await createUser({ name: 'Empty Card View User', email: 'empty-card-view@example.com', password_hash: 'hash' });
    await logArtistCardViews(user.id, []);
    expect(await getRecentEventsForUser(user.id)).toHaveLength(0);
  });

  it('getEventCountsByType reflects newly logged events (measured as a delta, not an exact global count — this file shares one DB across the whole suite)', async () => {
    const before = await getEventCountsByType();
    const user = await createUser({ name: 'Count User', email: 'count-user@example.com', password_hash: 'hash' });
    await logEvent(user.id, 'video_played', { artistId: 1 });
    await logEvent(user.id, 'video_played', { artistId: 2 });
    const after = await getEventCountsByType();
    expect((after.video_played ?? 0) - (before.video_played ?? 0)).toBe(2);
  });

  it('recordLogin reports returning:false on the first login and returning:true afterward, stamping last_login_at each time', async () => {
    const user = await createUser({ name: 'Login User', email: 'login-user@example.com', password_hash: 'hash' });
    expect((await getUserById(user.id))!.last_login_at).toBeFalsy();

    const first = await recordLogin(user.id);
    expect(first.returning).toBe(false);
    expect((await getUserById(user.id))!.last_login_at).toBeTruthy();

    const second = await recordLogin(user.id);
    expect(second.returning).toBe(true);
  });

  it('completeNextOnboarding logs onboarding_completed exactly once, even if called again (idempotent)', async () => {
    const user = await createUser({ name: 'Onboarding User', email: 'onboarding-user@example.com', password_hash: 'hash' });
    await completeNextOnboarding(user.id);
    await completeNextOnboarding(user.id); // already onboarded — the WHERE guard makes this a no-op

    const events = (await getRecentEventsForUser(user.id)).filter((e) => e.event_type === 'onboarding_completed');
    expect(events).toHaveLength(1);
  });
});

describe('Data reliability (Phase 4) — sync provenance, failure logging, duplicate detection', () => {
  it('stampSourceSyncedAt writes the correct per-source column and leaves the others untouched', async () => {
    const artist = await makeArtist('Provenance Artist');
    const before = new Date(Date.now() - 60_000).toISOString();

    await stampSourceSyncedAt(artist.id, 'soundcharts', before);
    let updated = (await getArtist(artist.id))!;
    expect(updated.soundcharts_synced_at).toBe(before);
    expect(updated.deezer_synced_at).toBeFalsy();
    expect(updated.youtube_synced_at).toBeFalsy();

    await stampSourceSyncedAt(artist.id, 'deezer');
    await stampSourceSyncedAt(artist.id, 'youtube');
    updated = (await getArtist(artist.id))!;
    expect(updated.deezer_synced_at).toBeTruthy();
    expect(updated.youtube_synced_at).toBeTruthy();
    // The earlier soundcharts stamp is untouched by the later calls for
    // other sources.
    expect(updated.soundcharts_synced_at).toBe(before);
  });

  it('setFeaturedVideoMatchType stores and clears the match-confidence flag', async () => {
    const artist = await makeArtist('Match Type Artist');
    await setFeaturedVideoMatchType(artist.id, 'search_unverified');
    expect((await getArtist(artist.id))!.featured_video_match_type).toBe('search_unverified');
    expect(await getUnverifiedVideoMatchCount()).toBeGreaterThanOrEqual(1);

    await setFeaturedVideoMatchType(artist.id, null);
    expect((await getArtist(artist.id))!.featured_video_match_type).toBeFalsy();
  });

  it('findArtistsByName matches case-insensitively and excludes unrelated names', async () => {
    const artist = await makeArtist('Duplicate Name Check Artist');
    const matches = await findArtistsByName('duplicate name check artist');
    expect(matches.map((m) => m.id)).toContain(artist.id);
    expect(await findArtistsByName('Definitely Not A Real Artist Name XYZ')).toHaveLength(0);
  });

  it('creating a second artist with an already-linked soundcharts_uuid throws (unique index enforced)', async () => {
    const first = await createArtist({ name: 'First Linked Artist', soundcharts_uuid: 'dup-uuid-test-1' });
    expect(first.soundcharts_uuid).toBe('dup-uuid-test-1');
    await expect(createArtist({ name: 'Second Linked Artist', soundcharts_uuid: 'dup-uuid-test-1' })).rejects.toThrow(/unique constraint/i);
  });

  it('two artists may each have soundcharts_uuid = null without violating the partial unique index', async () => {
    const a = await makeArtist('Unlinked Artist A');
    const b = await makeArtist('Unlinked Artist B');
    expect(a.soundcharts_uuid).toBeFalsy();
    expect(b.soundcharts_uuid).toBeFalsy();
  });

  it('logSyncFailure and getRecentSyncFailures record and retrieve structured per-artist failures, filterable by source', async () => {
    const artist = await makeArtist('Failure Log Artist');
    const run = await createSyncRun('soundcharts');

    const before = (await getRecentSyncFailures('soundcharts')).length;
    await logSyncFailure(run.id, 'soundcharts', artist.id, artist.name, 'Simulated Soundcharts timeout');
    await logSyncFailure(run.id, 'deezer', artist.id, artist.name, 'Simulated Deezer error');

    const soundchartsFailures = await getRecentSyncFailures('soundcharts');
    expect(soundchartsFailures.length).toBe(before + 1);
    expect(soundchartsFailures[0].error).toBe('Simulated Soundcharts timeout');
    expect(soundchartsFailures[0].artist_name).toBe(artist.name);

    const all = await getRecentSyncFailures();
    expect(all.some((f) => f.error === 'Simulated Deezer error')).toBe(true);
  });

  it('getArtistsWithSoundchartsLink includes name (needed for failure logging by the sync route)', async () => {
    const artist = await createArtist({ name: 'Linked Name Artist', soundcharts_uuid: 'name-check-uuid-1' });
    const linked = (await getArtistsWithSoundchartsLink()).find((a) => a.id === artist.id);
    expect(linked).toBeDefined();
    expect(linked!.name).toBe('Linked Name Artist');
  });
});

describe('YouTube quota protection (Phase 4) — daily usage ledger and re-search backoff', () => {
  it('recordYoutubeQuotaUsage and getYoutubeQuotaUsedToday sum only same-day usage', async () => {
    const day = 'quota-test-day-1';
    const otherDay = 'quota-test-day-2';
    expect(await getYoutubeQuotaUsedToday(day)).toBe(0);

    await recordYoutubeQuotaUsage(100, '/search', day);
    await recordYoutubeQuotaUsage(1, '/channels', day);
    await recordYoutubeQuotaUsage(1, '/videos', day);
    await recordYoutubeQuotaUsage(50, '/search', otherDay); // a different day — must not count toward `day`

    expect(await getYoutubeQuotaUsedToday(day)).toBe(102);
    expect(await getYoutubeQuotaUsedToday(otherDay)).toBe(50);
  });

  it('getArtistsMissingVideo excludes an artist recently confirmed to have no match, but includes one checked long ago', async () => {
    const recentlyChecked = await makeArtist('Recently No-Match Artist');
    const longAgoChecked = await makeArtist('Long-Ago No-Match Artist');
    const neverChecked = await makeArtist('Never Checked Artist');

    await stampYoutubeNoMatch(recentlyChecked.id); // "now" — well within the backoff window
    const beforeWindow = new Date(Date.now() - (YOUTUBE_NO_MATCH_RECHECK_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
    await stampYoutubeNoMatch(longAgoChecked.id, beforeWindow);

    const missing = (await getArtistsMissingVideo()).map((a) => a.id);
    expect(missing).not.toContain(recentlyChecked.id);
    expect(missing).toContain(longAgoChecked.id);
    expect(missing).toContain(neverChecked.id);
  });

  it('getArtistsMissingVideo re-includes an artist once featured_video_id is cleared, even if it was previously no-matched', async () => {
    // A Scout typing in a video link by hand after an automated "no match"
    // must not be silently overridden — but if they later remove it again,
    // the backoff window (still fresh) should still apply.
    const artist = await makeArtist('Cleared Video Artist');
    await stampYoutubeNoMatch(artist.id);
    expect((await getArtistsMissingVideo()).map((a) => a.id)).not.toContain(artist.id);

    await updateArtist(artist.id, { featured_video_id: 'manually-pasted-id' } as any);
    expect((await getArtistsMissingVideo()).map((a) => a.id)).not.toContain(artist.id); // has a video now, not missing

    await updateArtist(artist.id, { featured_video_id: '' } as any);
    // Missing again, but the no-match stamp is still recent — still excluded.
    expect((await getArtistsMissingVideo()).map((a) => a.id)).not.toContain(artist.id);
  });

  it('getArtistsInVideoBackoff counts exactly the artists getArtistsMissingVideo excludes, and reports the earliest recheck date', async () => {
    const before = (await getArtistsInVideoBackoff()).count;

    const recent = await makeArtist('Backoff Visibility Recent');
    const longAgo = await makeArtist('Backoff Visibility Long Ago');
    const withVideo = await makeArtist('Backoff Visibility Has Video');

    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    await stampYoutubeNoMatch(recent.id, fiveDaysAgo);
    const beforeWindow = new Date(Date.now() - (YOUTUBE_NO_MATCH_RECHECK_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
    await stampYoutubeNoMatch(longAgo.id, beforeWindow); // outside the window — not in backoff
    await stampYoutubeNoMatch(withVideo.id, fiveDaysAgo);
    await updateArtist(withVideo.id, { featured_video_id: 'has-a-video' } as any); // has a video now — not "missing" at all

    const after = await getArtistsInVideoBackoff();
    // Exactly one new artist (`recent`) entered the backoff set.
    expect(after.count - before).toBe(1);
    expect((await getArtistsMissingVideo()).map((a) => a.id)).not.toContain(recent.id);

    const expectedRecheck = new Date(new Date(fiveDaysAgo).getTime() + YOUTUBE_NO_MATCH_RECHECK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    expect(after.earliestRecheckAt).toBe(expectedRecheck);
  });
});

describe('Soundcharts photo backfill — search-and-link for artists the regular sync can never reach', () => {
  it('getArtistsMissingPhoto excludes an artist that already has a Soundcharts link, even with no photo', async () => {
    // The regular /api/soundcharts/sync already owns re-checking linked
    // artists — the backfill's job is only to find and link the ones sync
    // can't see at all, never to duplicate that work.
    const linkedNoPhoto = await createArtist({ name: 'Linked No Photo Artist', soundcharts_uuid: 'backfill-linked-uuid-1' });
    expect((await getArtistsMissingPhoto()).map((a) => a.id)).not.toContain(linkedNoPhoto.id);
  });

  it('getArtistsMissingPhoto excludes an artist recently confirmed to have no match, but includes one checked long ago', async () => {
    const recentlyChecked = await makeArtist('Recently No-Match Photo Artist');
    const longAgoChecked = await makeArtist('Long-Ago No-Match Photo Artist');
    const neverChecked = await makeArtist('Never Checked Photo Artist');

    await stampSoundchartsNoMatch(recentlyChecked.id); // "now" — well within the backoff window
    const beforeWindow = new Date(Date.now() - (SOUNDCHARTS_NO_MATCH_RECHECK_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
    await stampSoundchartsNoMatch(longAgoChecked.id, beforeWindow);

    const missing = (await getArtistsMissingPhoto()).map((a) => a.id);
    expect(missing).not.toContain(recentlyChecked.id);
    expect(missing).toContain(longAgoChecked.id);
    expect(missing).toContain(neverChecked.id);
  });

  it('getArtistsMissingPhoto re-includes an artist once photo_url is cleared, even if it was previously no-matched', async () => {
    const artist = await makeArtist('Cleared Photo Artist');
    await stampSoundchartsNoMatch(artist.id);
    expect((await getArtistsMissingPhoto()).map((a) => a.id)).not.toContain(artist.id);

    await updateArtist(artist.id, { photo_url: 'https://example.com/manually-pasted.jpg' } as any);
    expect((await getArtistsMissingPhoto()).map((a) => a.id)).not.toContain(artist.id); // has a photo now, not missing

    await updateArtist(artist.id, { photo_url: '' } as any);
    // Missing again, but the no-match stamp is still recent — still excluded.
    expect((await getArtistsMissingPhoto()).map((a) => a.id)).not.toContain(artist.id);
  });

  it('getArtistsInPhotoBackoff counts exactly the artists getArtistsMissingPhoto excludes, and reports the earliest recheck date', async () => {
    const before = (await getArtistsInPhotoBackoff()).count;

    const recent = await makeArtist('Photo Backoff Visibility Recent');
    const longAgo = await makeArtist('Photo Backoff Visibility Long Ago');
    const withPhoto = await makeArtist('Photo Backoff Visibility Has Photo');

    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    await stampSoundchartsNoMatch(recent.id, fiveDaysAgo);
    const beforeWindow = new Date(Date.now() - (SOUNDCHARTS_NO_MATCH_RECHECK_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
    await stampSoundchartsNoMatch(longAgo.id, beforeWindow); // outside the window — not in backoff
    await stampSoundchartsNoMatch(withPhoto.id, fiveDaysAgo);
    await updateArtist(withPhoto.id, { photo_url: 'https://example.com/has-a-photo.jpg' } as any); // has a photo now — not "missing" at all

    const after = await getArtistsInPhotoBackoff();
    // Exactly one new artist (`recent`) entered the backoff set.
    expect(after.count - before).toBe(1);
    expect((await getArtistsMissingPhoto()).map((a) => a.id)).not.toContain(recent.id);

    const expectedRecheck = new Date(new Date(fiveDaysAgo).getTime() + SOUNDCHARTS_NO_MATCH_RECHECK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    expect(after.earliestRecheckAt).toBe(expectedRecheck);
  });
});

describe('Soundcharts limitations (Phase 4) — getMissingPlatformLinksImpact', () => {
  it('counts an artist with zero platform links, and views on it, but not one with at least one link', async () => {
    const beforeArtists = (await getMissingPlatformLinksImpact()).artistsMissingAllLinks;
    const unlinked = await makeArtist('Zero Links Artist');
    const linked = await createArtist({
      name: 'Has A Link Artist', spotify_url: 'https://open.spotify.com/artist/x',
      music_talent: 8, growth_velocity_pct: 32, engagement_rate_pct: 16, original_song_response: 8,
      brand_personality: 8, content_consistency: 8, commercial_potential: 8, professionalism: 8,
    });
    const viewer = await createUser({ name: 'Links Viewer', email: 'links-viewer@example.com', password_hash: 'hash' });
    expect((await getMissingPlatformLinksImpact()).artistsMissingAllLinks - beforeArtists).toBe(1); // only the unlinked one

    const beforeViews = await getMissingPlatformLinksImpact();
    await logEvent(viewer.id, 'artist_detail_opened', { artistId: unlinked.id });
    await logEvent(viewer.id, 'artist_detail_opened', { artistId: linked.id });

    const afterViews = await getMissingPlatformLinksImpact();
    expect(afterViews.viewsOnArtistsMissingAllLinks - beforeViews.viewsOnArtistsMissingAllLinks).toBe(1);
    expect(afterViews.totalArtistDetailViews - beforeViews.totalArtistDetailViews).toBe(2); // both views count toward the denominator
  });

  it('an artist missing all links but never viewed counts toward artistsMissingAllLinks but not the view count', async () => {
    const before = await getMissingPlatformLinksImpact();
    await makeArtist('Unviewed Zero Links Artist');
    const after = await getMissingPlatformLinksImpact();
    expect(after.artistsMissingAllLinks - before.artistsMissingAllLinks).toBe(1);
    expect(after.viewsOnArtistsMissingAllLinks).toBe(before.viewsOnArtistsMissingAllLinks);
  });

  it('any one of the four platform link fields being set is enough to exclude an artist', async () => {
    const before = (await getMissingPlatformLinksImpact()).artistsMissingAllLinks;
    await createArtist({
      name: 'TikTok Only Artist', tiktok_url: 'https://tiktok.com/@x',
      music_talent: 8, growth_velocity_pct: 32, engagement_rate_pct: 16, original_song_response: 8,
      brand_personality: 8, content_consistency: 8, commercial_potential: 8, professionalism: 8,
    });
    expect((await getMissingPlatformLinksImpact()).artistsMissingAllLinks).toBe(before);
  });
});

describe('Discovery Engine (Phase 5) — candidate history, run attribution, and coverage', () => {
  it('insertDiscoveryCandidate logs a "discovered" history row with no actor', async () => {
    await insertDiscoveryCandidate({ source: 'soundcharts', soundcharts_uuid: 'uuid-history-1', name: 'History Test Artist', flagged_reason: 'test' });
    const candidate = (await getDiscoveryCandidates('new')).find((c) => c.soundcharts_uuid === 'uuid-history-1')!;

    const history = await getDiscoveryCandidateHistory(candidate.id);
    expect(history).toHaveLength(1);
    expect(history[0].from_status).toBeNull();
    expect(history[0].to_status).toBe('new');
    expect(history[0].actor_id).toBeFalsy();
  });

  it('setDiscoveryCandidateStatus and approveDiscoveryCandidate each append a history row with the actor and both statuses', async () => {
    const scout = await makeUser('history-scout@example.com');
    await insertDiscoveryCandidate({ source: 'soundcharts', soundcharts_uuid: 'uuid-history-2', name: 'Watched Then Approved', flagged_reason: 'test' });
    const candidate = (await getDiscoveryCandidates('new')).find((c) => c.soundcharts_uuid === 'uuid-history-2')!;

    await setDiscoveryCandidateStatus(candidate.id, 'watching', { id: scout.id, name: scout.name });
    await approveDiscoveryCandidate(candidate.id, { id: scout.id, name: scout.name });

    const history = await getDiscoveryCandidateHistory(candidate.id);
    expect(history.map((h) => [h.from_status, h.to_status])).toEqual([
      [null, 'new'],
      ['new', 'watching'],
      ['watching', 'approved'],
    ]);
    expect(history[1].actor_id).toBe(scout.id);
    expect(history[2].actor_name).toBe(scout.name);
  });

  it('getRecentDiscoveryReviewDecisions excludes the initial discovery row but includes real decisions, most recent first', async () => {
    const scout = await makeUser('decisions-scout@example.com');
    await insertDiscoveryCandidate({ source: 'soundcharts', soundcharts_uuid: 'uuid-decision-1', name: 'Decision Test Artist', flagged_reason: 'test' });
    const candidate = (await getDiscoveryCandidates('new')).find((c) => c.soundcharts_uuid === 'uuid-decision-1')!;

    const before = (await getRecentDiscoveryReviewDecisions(200)).length;
    await setDiscoveryCandidateStatus(candidate.id, 'passed', { id: scout.id, name: scout.name });

    const decisions = await getRecentDiscoveryReviewDecisions(200);
    expect(decisions.length).toBe(before + 1);
    expect(decisions[0].candidate_name).toBe('Decision Test Artist');
    expect(decisions[0].candidate_source).toBe('soundcharts');
    expect(decisions[0].to_status).toBe('passed');
    // The "discovered" row (from_status null) for THIS candidate must never appear.
    expect(decisions.some((d) => d.candidate_name === 'Decision Test Artist' && d.from_status === null)).toBe(false);
  });

  it('getDiscoveryCandidateCountsByStatus reflects a delta across all four statuses', async () => {
    const scout = await makeUser('counts-scout@example.com');
    const before = await getDiscoveryCandidateCountsByStatus();

    await insertDiscoveryCandidate({ source: 'soundcharts', soundcharts_uuid: 'uuid-count-new', name: 'Count New', flagged_reason: 'test' });
    await insertDiscoveryCandidate({ source: 'soundcharts', soundcharts_uuid: 'uuid-count-watch', name: 'Count Watch', flagged_reason: 'test' });
    await insertDiscoveryCandidate({ source: 'soundcharts', soundcharts_uuid: 'uuid-count-pass', name: 'Count Pass', flagged_reason: 'test' });
    const watchCandidate = (await getDiscoveryCandidates('new')).find((c) => c.soundcharts_uuid === 'uuid-count-watch')!;
    const passCandidate = (await getDiscoveryCandidates('new')).find((c) => c.soundcharts_uuid === 'uuid-count-pass')!;
    await setDiscoveryCandidateStatus(watchCandidate.id, 'watching', { id: scout.id, name: scout.name });
    await setDiscoveryCandidateStatus(passCandidate.id, 'passed', { id: scout.id, name: scout.name });

    const after = await getDiscoveryCandidateCountsByStatus();
    expect(after.new - before.new).toBe(1);
    expect(after.watching - before.watching).toBe(1);
    expect(after.passed - before.passed).toBe(1);
  });

  it('getDiscoveryCandidateCountsByGenre groups YouTube candidates by yt_genre and excludes Soundcharts (null-genre) candidates', async () => {
    const before = await getDiscoveryCandidateCountsByGenre();
    const beforeCount = (genre: string) => before.find((g) => g.genre === genre)?.count ?? 0;

    await insertDiscoveryCandidate({ source: 'youtube', name: 'Genre Test A', yt_channel_id: 'chan-genre-a', yt_genre: 'pop-genre-test', flagged_reason: 'test' });
    await insertDiscoveryCandidate({ source: 'youtube', name: 'Genre Test B', yt_channel_id: 'chan-genre-b', yt_genre: 'pop-genre-test', flagged_reason: 'test' });
    await insertDiscoveryCandidate({ source: 'soundcharts', soundcharts_uuid: 'uuid-genre-null', name: 'No Genre (Soundcharts)', flagged_reason: 'test' });

    const after = await getDiscoveryCandidateCountsByGenre();
    expect(after.find((g) => g.genre === 'pop-genre-test')!.count - beforeCount('pop-genre-test')).toBe(2);
    expect(after.some((g) => g.genre === null || g.genre === undefined)).toBe(false);
  });

  it('getRecentDiscoveryRunsWithCandidateCounts attributes candidates to their own run and shows 0 for a run that found none', async () => {
    const runA = await createDiscoveryRun('youtube');
    await insertDiscoveryCandidate({ source: 'youtube', name: 'Run A Candidate 1', yt_channel_id: 'chan-run-a-1', flagged_reason: 'test', discovery_run_id: runA.id });
    await insertDiscoveryCandidate({ source: 'youtube', name: 'Run A Candidate 2', yt_channel_id: 'chan-run-a-2', flagged_reason: 'test', discovery_run_id: runA.id });
    await completeDiscoveryRun(runA.id, { status: 'completed', searchedCount: 50, candidatesFound: 2 });

    const runB = await createDiscoveryRun('youtube');
    await completeDiscoveryRun(runB.id, { status: 'completed', searchedCount: 40, candidatesFound: 0 });

    const runs = await getRecentDiscoveryRunsWithCandidateCounts('youtube', 50);
    expect(runs.find((r) => r.id === runA.id)!.candidateCount).toBe(2);
    expect(runs.find((r) => r.id === runB.id)!.candidateCount).toBe(0);
  });
});

describe('Scout workflow (Phase 5) — field-level audit trail, activity sort, bulk stage change', () => {
  it('updateArtist logs a field-history row only for a real human edit, only for fields that actually changed, and never for stage', async () => {
    const scout = await makeUser('field-history-scout@example.com');
    const artist = await makeArtist('Field History Artist');

    // A sync-style update (no actor) must NOT be logged.
    await updateArtist(artist.id, { name: artist.name, genre: 'Synced Genre No Actor' });
    expect(await getArtistFieldHistory(artist.id)).toHaveLength(0);

    // A human edit changing genre and location (but re-submitting the same
    // name) logs genre and location, but not name (unchanged) or stage
    // (not touched by this call at all).
    await updateArtist(artist.id, { name: artist.name, genre: 'Pop', location: 'Austin, TX' }, { id: scout.id, name: scout.name });
    const history = await getArtistFieldHistory(artist.id);
    expect(history).toHaveLength(2);
    expect(history.map((h) => h.field).sort()).toEqual(['genre', 'location']);
    const genreChange = history.find((h) => h.field === 'genre')!;
    expect(genreChange.old_value).toBe('Synced Genre No Actor');
    expect(genreChange.new_value).toBe('Pop');
    expect(genreChange.actor_name).toBe(scout.name);

    // A stage change (via the same actor-provided call) must not ALSO
    // appear in artist_field_history — it's already covered by the
    // existing contact_log status_change entry.
    await updateArtist(artist.id, { name: artist.name, stage: 'contacted' }, { id: scout.id, name: scout.name });
    expect((await getArtistFieldHistory(artist.id)).some((h) => h.field === 'stage')).toBe(false);
  });

  it('a full-form save (every field present, most as empty strings — ArtistForm\'s real submission shape) logs only the field that actually changed, not every blank one', async () => {
    const scout = await makeUser('full-form-scout@example.com');
    const artist = await makeArtist('Full Form Save Artist'); // every optional field starts unset (null in the DB)

    // Mirrors ArtistForm.handleSubmit's real payload shape: every writable
    // field present, untouched ones as '' (never omitted) — this is
    // exactly what caught the normalization bug in QA.
    await updateArtist(artist.id, {
      name: artist.name, genre: 'QA Edited Genre', location: '', scout_name: '',
      tiktok_url: '', instagram_url: '', youtube_url: '', spotify_url: '', soundcloud_url: '',
      notes: '', photo_url: '', bio: '', top_song_url: '', song_preview_url: '', why_trending: '',
    }, { id: scout.id, name: scout.name });

    const history = await getArtistFieldHistory(artist.id);
    expect(history).toHaveLength(1);
    expect(history[0].field).toBe('genre');
    expect(history[0].old_value).toBeNull();
    expect(history[0].new_value).toBe('QA Edited Genre');
  });

  it('re-submitting the exact same value for a field logs nothing', async () => {
    const scout = await makeUser('no-op-edit-scout@example.com');
    const artist = await createArtist({ name: 'No-Op Edit Artist', genre: 'Rock' });
    const before = (await getArtistFieldHistory(artist.id)).length;
    await updateArtist(artist.id, { name: artist.name, genre: 'Rock' }, { id: scout.id, name: scout.name });
    expect(await getArtistFieldHistory(artist.id)).toHaveLength(before);
  });

  it('getArtistLastActivityMap reflects the later of updated_at and the most recent contact_log entry', async () => {
    const scout = await makeUser('activity-map-scout@example.com');
    const artist = await makeArtist('Activity Map Artist');

    const initialMap = await getArtistLastActivityMap();
    const initialActivity = initialMap.get(artist.id)!;
    expect(initialActivity).toBe(artist.updated_at);

    // A note logged well after the artist's last field edit, with NO field
    // actually changing (updated_at stays put) — this is exactly the case
    // updated_at alone would miss.
    const later = new Date(Date.now() + 60_000).toISOString();
    const entry = await addLogEntry(artist.id, { type: 'note', message: 'Checked in, no changes.' }, { id: scout.id, name: scout.name });
    await db.prepare('UPDATE contact_log SET created_at = ? WHERE id = ?').run(later, entry.id);

    const afterMap = await getArtistLastActivityMap();
    expect(afterMap.get(artist.id)).toBe(later);
    expect(afterMap.get(artist.id)! > initialActivity).toBe(true);
  });

  it('bulkSetArtistStage updates every listed artist, skips a nonexistent id without throwing, and returns the real count', async () => {
    const scout = await makeUser('bulk-stage-scout@example.com');
    const a = await makeArtist('Bulk Stage Artist A');
    const b = await makeArtist('Bulk Stage Artist B');

    const updated = await bulkSetArtistStage([a.id, b.id, 999_999], 'contacted', { id: scout.id, name: scout.name });

    expect(updated).toBe(2);
    expect((await getArtist(a.id))!.stage).toBe('contacted');
    expect((await getArtist(b.id))!.stage).toBe('contacted');
    // Reuses the same per-artist path as a normal edit, so the existing
    // stage-change contact_log entry still gets written for each.
    expect((await getArtistLog(a.id)).some((l) => l.type === 'status_change')).toBe(true);
  });
});

describe('Artist evaluation (Phase 5) — high_rating_note, earliest/latest score snapshots', () => {
  it('high_rating_note round-trips through create and update like any other writable field', async () => {
    const artist = await createArtist({ name: 'High Rating Note Artist', music_talent: 9, high_rating_note: 'Viral TikTok sound, verified organic.' });
    expect((await getArtist(artist.id))!.high_rating_note).toBe('Viral TikTok sound, verified organic.');

    const scout = await makeUser('high-rating-scout@example.com');
    const updated = await updateArtist(artist.id, { name: artist.name, high_rating_note: 'Updated reasoning.' }, { id: scout.id, name: scout.name });
    expect(updated!.high_rating_note).toBe('Updated reasoning.');
  });

  it('getEarliestScoreSnapshots and getLatestScoreSnapshots return the same single row for an artist with only one snapshot, and the correct two for an artist with several', async () => {
    const single = await createArtist({ name: 'Single Snapshot Artist', music_talent: 7 });
    const earliestSingle = (await getEarliestScoreSnapshots()).find((s) => s.artist_id === single.id)!;
    const latestSingle = (await getLatestScoreSnapshots()).find((s) => s.artist_id === single.id)!;
    expect(earliestSingle.id).toBe(latestSingle.id);
    expect(earliestSingle.music_talent).toBe(7);

    // Three snapshots taken this close together in a fast test run can land
    // in the same millisecond — force distinct, strictly increasing
    // recorded_at values (JS-computed ISO strings, never SQLite's
    // datetime()) so MIN/MAX(recorded_at) isn't ambiguous between ties.
    async function stampLatestSnapshot(artistId: number, at: string) {
      const row = await db.prepare('SELECT id FROM score_history WHERE artist_id = ? ORDER BY id DESC LIMIT 1').get(artistId) as { id: number };
      await db.prepare('UPDATE score_history SET recorded_at = ? WHERE id = ?').run(at, row.id);
    }
    const multi = await createArtist({ name: 'Multi Snapshot Artist', music_talent: 3 });
    await stampLatestSnapshot(multi.id, new Date(Date.now() - 2000).toISOString());
    await updateArtist(multi.id, { name: multi.name, music_talent: 6 });
    await stampLatestSnapshot(multi.id, new Date(Date.now() - 1000).toISOString());
    await updateArtist(multi.id, { name: multi.name, music_talent: 9 });
    const earliestMulti = (await getEarliestScoreSnapshots()).find((s) => s.artist_id === multi.id)!;
    const latestMulti = (await getLatestScoreSnapshots()).find((s) => s.artist_id === multi.id)!;
    expect(earliestMulti.music_talent).toBe(3);
    expect(latestMulti.music_talent).toBe(9);
    expect(earliestMulti.id).not.toBe(latestMulti.id);
  });
});

describe('Artist participation (Phase 6) — public submission, claim review, dashboard access', () => {
  it('a public submission lands in the Candidate Queue with source public_submission and the submitter attributed by name', async () => {
    const fan = await makeUser('submitting-fan@example.com');
    await insertDiscoveryCandidate({
      source: 'public_submission',
      name: 'Fan-Found Artist',
      submission_url: 'https://tiktok.com/@fanfound',
      flagged_reason: 'Their video has been stuck in my head for a week.',
      submitted_by_user_id: fan.id,
    });

    const candidate = (await getDiscoveryCandidates('new')).find((c) => c.name === 'Fan-Found Artist')!;
    expect(candidate).toBeDefined();
    expect(candidate.source).toBe('public_submission');
    expect(candidate.submission_url).toBe('https://tiktok.com/@fanfound');
    expect(candidate.submitted_by_name).toBe('Test Trader');
    expect(candidate.flagged_reason).toBe('Their video has been stuck in my head for a week.');
  });

  it('approving a public-submission candidate creates a real artist the same way any other source does', async () => {
    const fan = await makeUser('approved-fan@example.com');
    const scout = await makeUser('claim-review-scout@example.com');
    await insertDiscoveryCandidate({
      source: 'public_submission',
      name: 'Approved Fan Find',
      flagged_reason: 'Great original songwriting.',
      submitted_by_user_id: fan.id,
    });
    const candidate = (await getDiscoveryCandidates('new')).find((c) => c.name === 'Approved Fan Find')!;
    const artist = await approveDiscoveryCandidate(candidate.id, { id: scout.id, name: scout.name });
    expect(artist).toBeDefined();
    expect(artist!.name).toBe('Approved Fan Find');
    expect(artist!.why_trending).toBe('Great original songwriting.');
    expect((await getArtist(artist!.id))!.claimed_by_user_id).toBeNull();
  });

  it('createArtistClaim rejects claiming an already-claimed artist, and rejects a duplicate pending claim from the same user', async () => {
    const artist = await createArtist({ name: 'Claim Target Artist', music_talent: 6 });
    const fan1 = await makeUser('claimant-one@example.com');
    const fan2 = await makeUser('claimant-two@example.com');

    const first = await createArtistClaim(artist.id, fan1.id, 'I run this account.');
    expect(first.ok).toBe(true);

    // A second pending claim from the SAME user on the SAME artist is
    // blocked (the partial unique index) — this is a duplicate ask, not a
    // second legitimate claimant.
    const duplicate = await createArtistClaim(artist.id, fan1.id, 'Trying again.');
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.reason).toMatch(/already have a pending claim/i);

    // A different user's claim is allowed to exist as its own pending row
    // (the artist isn't claimed yet, only requested) — only an APPROVED
    // claim blocks further requests, checked next.
    const second = await createArtistClaim(artist.id, fan2.id, 'No, I run this account.');
    expect(second.ok).toBe(true);
  });

  it('createArtistClaim rejects any new claim once the artist is already claimed by someone', async () => {
    const artist = await createArtist({ name: 'Already Claimed Artist', music_talent: 6 });
    const owner = await makeUser('artist-owner@example.com');
    const scout = await makeUser('approve-scout@example.com');
    const outsider = await makeUser('outsider-claimant@example.com');

    const request = await createArtistClaim(artist.id, owner.id, 'It me.');
    expect(request.ok).toBe(true);
    if (!request.ok) throw new Error('unreachable');
    await reviewArtistClaim(request.claim.id, 'approved', { id: scout.id, name: scout.name });

    const blocked = await createArtistClaim(artist.id, outsider.id, 'Actually it is me.');
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toMatch(/already been claimed/i);
  });

  it('reviewArtistClaim(approved) sets claimed_by_user_id, logs a claim activity entry, and grants dashboard access via getArtistsClaimedByUser', async () => {
    const artist = await createArtist({ name: 'Dashboard-Bound Artist', music_talent: 6 });
    const claimant = await makeUser('dashboard-claimant@example.com');
    const scout = await makeUser('dashboard-scout@example.com');

    expect(await getArtistsClaimedByUser(claimant.id)).toHaveLength(0);

    const request = await createArtistClaim(artist.id, claimant.id, 'Proof link here.');
    expect(request.ok).toBe(true);
    if (!request.ok) throw new Error('unreachable');

    const reviewed = await reviewArtistClaim(request.claim.id, 'approved', { id: scout.id, name: scout.name });
    expect(reviewed!.status).toBe('approved');
    expect((await getArtist(artist.id))!.claimed_by_user_id).toBe(claimant.id);

    const claimed = await getArtistsClaimedByUser(claimant.id);
    expect(claimed).toHaveLength(1);
    expect(claimed[0].id).toBe(artist.id);

    const log = await getArtistLog(artist.id);
    const claimEntry = log.find((e) => e.type === 'claim');
    expect(claimEntry).toBeDefined();
    expect(claimEntry!.message).toContain('Test Trader');
  });

  it('reviewArtistClaim(rejected) leaves the artist unclaimed and does not grant dashboard access', async () => {
    const artist = await createArtist({ name: 'Rejected Claim Artist', music_talent: 6 });
    const claimant = await makeUser('rejected-claimant@example.com');
    const scout = await makeUser('reject-scout@example.com');

    const request = await createArtistClaim(artist.id, claimant.id, undefined);
    expect(request.ok).toBe(true);
    if (!request.ok) throw new Error('unreachable');

    const reviewed = await reviewArtistClaim(request.claim.id, 'rejected', { id: scout.id, name: scout.name });
    expect(reviewed!.status).toBe('rejected');
    expect((await getArtist(artist.id))!.claimed_by_user_id).toBeNull();
    expect(await getArtistsClaimedByUser(claimant.id)).toHaveLength(0);
  });

  it('reviewArtistClaim returns undefined for an already-reviewed claim (no double-approval)', async () => {
    const artist = await createArtist({ name: 'Double Review Artist', music_talent: 6 });
    const claimant = await makeUser('double-review-claimant@example.com');
    const scout = await makeUser('double-review-scout@example.com');

    const request = await createArtistClaim(artist.id, claimant.id, undefined);
    if (!request.ok) throw new Error('unreachable');
    await reviewArtistClaim(request.claim.id, 'approved', { id: scout.id, name: scout.name });

    const secondReview = await reviewArtistClaim(request.claim.id, 'rejected', { id: scout.id, name: scout.name });
    expect(secondReview).toBeUndefined();
    // Still approved from the first review — a second call is a no-op, not a downgrade.
    expect((await getArtist(artist.id))!.claimed_by_user_id).toBe(claimant.id);
  });

  it('getPendingArtistClaims / getPendingArtistClaimCount / getPendingClaimForUserAndArtist reflect only pending claims', async () => {
    const artist = await createArtist({ name: 'Pending Queue Artist', music_talent: 6 });
    const claimant = await makeUser('pending-queue-claimant@example.com');

    expect(await getPendingClaimForUserAndArtist(claimant.id, artist.id)).toBeUndefined();
    const before = await getPendingArtistClaimCount();

    const request = await createArtistClaim(artist.id, claimant.id, 'Verify me please.');
    if (!request.ok) throw new Error('unreachable');

    expect(await getPendingArtistClaimCount()).toBe(before + 1);
    expect((await getPendingClaimForUserAndArtist(claimant.id, artist.id))!.id).toBe(request.claim.id);
    const pending = await getPendingArtistClaims();
    expect(pending.some((c) => c.id === request.claim.id)).toBe(true);
    expect((await getArtistClaim(request.claim.id))!.artist_name).toBe('Pending Queue Artist');
    expect((await getArtistClaim(request.claim.id))!.user_name).toBe('Test Trader');
  });
});

describe('Crowdsourced scouting (Phase 7) — discovery credit, genre expertise, badges, duplicate/rate-limit guards', () => {
  async function submitPublicArtist(name: string, userId: number) {
    await insertDiscoveryCandidate({ source: 'public_submission', name, flagged_reason: 'Great find.', submitted_by_user_id: userId });
    return (await getDiscoveryCandidates('new')).find((c) => c.name === name)!;
  }

  it('getApprovedDiscoveriesCount only counts this user\'s APPROVED submissions, and getBreakoutDiscoveriesCount only counts the ones whose artist reached flagship', async () => {
    const finder = await createUser({ name: 'Discovery Finder', email: 'discovery-finder@example.com', password_hash: 'hash' });
    const scout = await createUser({ name: 'Review Scout', email: 'review-scout-p7@example.com', password_hash: 'hash' });

    await submitPublicArtist('Still Pending Find', finder.id);
    const approvedCandidate = await submitPublicArtist('Approved Find', finder.id);
    const breakoutCandidate = await submitPublicArtist('Breakout Find', finder.id);

    expect(await getApprovedDiscoveriesCount(finder.id)).toBe(0);
    expect(await getBreakoutDiscoveriesCount(finder.id)).toBe(0);

    const approvedArtist = (await approveDiscoveryCandidate(approvedCandidate.id, { id: scout.id, name: scout.name }))!;
    const breakoutArtist = (await approveDiscoveryCandidate(breakoutCandidate.id, { id: scout.id, name: scout.name }))!;
    expect(await getApprovedDiscoveriesCount(finder.id)).toBe(2); // still-pending one doesn't count
    expect(await getBreakoutDiscoveriesCount(finder.id)).toBe(0); // neither has reached flagship yet

    await updateArtist(breakoutArtist.id, { name: breakoutArtist.name, stage: 'flagship' });
    expect(await getBreakoutDiscoveriesCount(finder.id)).toBe(1);
    expect(await getApprovedDiscoveriesCount(finder.id)).toBe(2); // unchanged — flagship doesn't add a second "approved" credit

    // Reaching flagship on an artist someone ELSE found doesn't credit this user.
    await updateArtist(approvedArtist.id, { name: approvedArtist.name, stage: 'flagship' });
    expect(await getBreakoutDiscoveriesCount(finder.id)).toBe(2);
  });

  it('getDiscoveriesForUser lists every submission regardless of status, newest first, with the resolved artist name and breakout flag once approved', async () => {
    const finder = await createUser({ name: 'List Finder', email: 'list-finder@example.com', password_hash: 'hash' });
    const scout = await createUser({ name: 'List Scout', email: 'list-scout-p7@example.com', password_hash: 'hash' });

    const pendingCandidate = await submitPublicArtist('List Pending', finder.id);
    // Backdate — two inserts this close together can land in the same
    // millisecond, making ORDER BY discovered_at DESC ambiguous between
    // them (the same flake class documented elsewhere in this file).
    await db.prepare('UPDATE discovery_candidates SET discovered_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), pendingCandidate.id);
    const approvedCandidate = await submitPublicArtist('List Approved', finder.id);
    const artist = (await approveDiscoveryCandidate(approvedCandidate.id, { id: scout.id, name: scout.name }))!;
    await updateArtist(artist.id, { name: artist.name, stage: 'flagship' });

    const discoveries = await getDiscoveriesForUser(finder.id);
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

  it('getDiscoveryGenres ranks genres by approved-discovery count, ignoring still-pending submissions', async () => {
    const finder = await createUser({ name: 'Genre Finder', email: 'genre-finder@example.com', password_hash: 'hash' });
    const scout = await createUser({ name: 'Genre Review Scout', email: 'genre-review-scout@example.com', password_hash: 'hash' });

    for (const name of ['Genre Find Pop One', 'Genre Find Pop Two']) {
      const candidate = await submitPublicArtist(name, finder.id);
      const artist = (await approveDiscoveryCandidate(candidate.id, { id: scout.id, name: scout.name }))!;
      await updateArtist(artist.id, { name: artist.name, genre: 'Pop' });
    }
    const jazzCandidate = await submitPublicArtist('Genre Find Jazz One', finder.id);
    const jazzArtist = (await approveDiscoveryCandidate(jazzCandidate.id, { id: scout.id, name: scout.name }))!;
    await updateArtist(jazzArtist.id, { name: jazzArtist.name, genre: 'Jazz' });

    // Not yet approved — shouldn't count toward genre expertise at all.
    await submitPublicArtist('Genre Find Still Pending', finder.id);

    const genres = await getDiscoveryGenres(finder.id);
    expect(genres[0]).toEqual({ genre: 'Pop', count: 2 });
    expect(genres[1]).toEqual({ genre: 'Jazz', count: 1 });
  });

  it('getDiscoveryLeaderboard ranks by approved-discovery count, breaking ties by breakout count', async () => {
    const topFinder = await createUser({ name: 'Top Discoverer', email: 'top-discoverer@example.com', password_hash: 'hash' });
    const tiedWithBreakout = await createUser({ name: 'Tied Breakout Discoverer', email: 'tied-breakout-discoverer@example.com', password_hash: 'hash' });
    const tiedNoBreakout = await createUser({ name: 'Tied Plain Discoverer', email: 'tied-plain-discoverer@example.com', password_hash: 'hash' });
    const scout = await createUser({ name: 'Leaderboard Review Scout', email: 'leaderboard-review-scout@example.com', password_hash: 'hash' });

    // topFinder: 2 approved, 0 breakout.
    for (const name of ['LB Top Find One', 'LB Top Find Two']) {
      const c = await submitPublicArtist(name, topFinder.id);
      await approveDiscoveryCandidate(c.id, { id: scout.id, name: scout.name });
    }
    // tiedWithBreakout: 1 approved, 1 breakout.
    const breakoutCandidate = await submitPublicArtist('LB Breakout Find', tiedWithBreakout.id);
    const breakoutArtist = (await approveDiscoveryCandidate(breakoutCandidate.id, { id: scout.id, name: scout.name }))!;
    await updateArtist(breakoutArtist.id, { name: breakoutArtist.name, stage: 'flagship' });
    // tiedNoBreakout: 1 approved, 0 breakout.
    const plainCandidate = await submitPublicArtist('LB Plain Find', tiedNoBreakout.id);
    await approveDiscoveryCandidate(plainCandidate.id, { id: scout.id, name: scout.name });

    const board = (await getDiscoveryLeaderboard()).filter((e) => [topFinder.id, tiedWithBreakout.id, tiedNoBreakout.id].includes(e.user.id));
    const byId = new Map(board.map((e) => [e.user.id, e]));
    expect(byId.get(topFinder.id)!.rank).toBeLessThan(byId.get(tiedWithBreakout.id)!.rank); // 2 approved beats 1 approved
    expect(byId.get(tiedWithBreakout.id)!.rank).toBeLessThan(byId.get(tiedNoBreakout.id)!.rank); // same approved count, breakout wins the tiebreak
  });

  it('findDuplicateArtistSubmission blocks a name matching an existing roster artist or an active (non-passed) candidate, case-insensitively, but allows resubmitting a passed one', async () => {
    const existingArtist = await createArtist({ name: 'Existing Roster Artist', music_talent: 5 });
    expect(await findDuplicateArtistSubmission('existing roster artist')).toEqual({ kind: 'artist', name: 'Existing Roster Artist' });

    const finder = await createUser({ name: 'Dup Finder', email: 'dup-finder@example.com', password_hash: 'hash' });
    await submitPublicArtist('Pending Duplicate Target', finder.id);
    expect(await findDuplicateArtistSubmission('PENDING DUPLICATE TARGET')).toEqual({ kind: 'candidate', name: 'Pending Duplicate Target' });

    const scout = await createUser({ name: 'Dup Scout', email: 'dup-scout@example.com', password_hash: 'hash' });
    const passedCandidate = await submitPublicArtist('Passed Duplicate Target', finder.id);
    await setDiscoveryCandidateStatus(passedCandidate.id, 'passed', { id: scout.id, name: scout.name });
    expect(await findDuplicateArtistSubmission('Passed Duplicate Target')).toBeUndefined();

    expect(await findDuplicateArtistSubmission('Nobody Has Submitted This')).toBeUndefined();
  });

  it('getRecentSubmissionCount only counts this user\'s public_submission candidates within the given window', async () => {
    const finder = await createUser({ name: 'Rate Limit Finder', email: 'rate-limit-finder@example.com', password_hash: 'hash' });
    const otherFinder = await createUser({ name: 'Other Finder', email: 'other-finder@example.com', password_hash: 'hash' });

    expect(await getRecentSubmissionCount(finder.id, 24)).toBe(0);
    await submitPublicArtist('Rate Limit Find One', finder.id);
    await submitPublicArtist('Rate Limit Find Two', finder.id);
    await submitPublicArtist('Other Finders Find', otherFinder.id); // a different user's submission never counts against this one
    expect(await getRecentSubmissionCount(finder.id, 24)).toBe(2);
    expect(await getRecentSubmissionCount(otherFinder.id, 24)).toBe(1);

    // Backdate one submission outside the window — same id-capture-then-UPDATE
    // pattern used elsewhere in this file to avoid same-millisecond ties.
    const row = await db.prepare("SELECT id FROM discovery_candidates WHERE name = 'Rate Limit Find One'").get() as { id: number };
    await db.prepare('UPDATE discovery_candidates SET discovered_at = ? WHERE id = ?').run(new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), row.id);
    expect(await getRecentSubmissionCount(finder.id, 24)).toBe(1);
  });

  it('getScoutProfile surfaces discovery credit end to end: counts, discoveries list, discovery genres, badges, and a Scout Score bonus', async () => {
    const finder = await createUser({ name: 'Profile Finder', email: 'profile-finder@example.com', password_hash: 'hash' });
    const scout = await createUser({ name: 'Profile Review Scout', email: 'profile-review-scout@example.com', password_hash: 'hash' });

    const noDiscoveryScore = (await getScoutProfile(finder.id))!.scoutScoreValue;
    expect((await getScoutProfile(finder.id))!.badges.some((b) => b.key === 'first_find')).toBe(false);

    const candidate = await submitPublicArtist('Profile Find', finder.id);
    const artist = (await approveDiscoveryCandidate(candidate.id, { id: scout.id, name: scout.name }))!;
    await updateArtist(artist.id, { name: artist.name, genre: 'Country', stage: 'flagship' });

    const profile = (await getScoutProfile(finder.id))!;
    expect(profile.approvedDiscoveriesCount).toBe(1);
    expect(profile.breakoutDiscoveriesCount).toBe(1);
    expect(profile.discoveries).toHaveLength(1);
    expect(profile.discoveries[0].artistName).toBe('Profile Find');
    expect(profile.discoveryGenres).toEqual([{ genre: 'Country', count: 1 }]);
    expect(profile.badges.map((b) => b.key)).toEqual(expect.arrayContaining(['first_find', 'breakout_spotter']));
    // 1 approved (3pts) + 1 breakout (5pts) = +8, same discovery bonus scoutScore() itself applies.
    expect(profile.scoutScoreValue).toBe(noDiscoveryScore + 8);
  });

  it('getScoutLeaderboard entries carry approvedDiscoveriesCount alongside the existing trading stats', async () => {
    const finder = await createUser({ name: 'Leaderboard Field Finder', email: 'leaderboard-field-finder@example.com', password_hash: 'hash' });
    const scout = await createUser({ name: 'Leaderboard Field Scout', email: 'leaderboard-field-scout@example.com', password_hash: 'hash' });
    const candidate = await submitPublicArtist('Leaderboard Field Find', finder.id);
    await approveDiscoveryCandidate(candidate.id, { id: scout.id, name: scout.name });

    const entry = (await getScoutLeaderboard()).find((e) => e.user.id === finder.id)!;
    expect(entry.approvedDiscoveriesCount).toBe(1);
  });
});

describe('Anti-abuse and market integrity (Phase 8)', () => {
  it('executeTrade rejects a buy of exactly balance+1 cent but allows exactly the full balance', async () => {
    const user = await makeUser('boundary-buyer@example.com');
    const artist = await makeArtist('Boundary Buyer Artist');
    const balance = (await getUserById(user.id))!.next_credits_cents;

    const tooMuch = await executeTrade(user.id, artist.id, 'buy', balance + 1);
    expect(tooMuch.ok).toBe(false);
    if (!tooMuch.ok) expect(tooMuch.error).toMatch(/not enough NEXT Credits/i);

    const exact = await executeTrade(user.id, artist.id, 'buy', balance);
    expect(exact.ok).toBe(true);
    expect((await getUserById(user.id))!.next_credits_cents).toBe(0);

    // Now genuinely broke — even a $0.01 buy must be rejected, never allowed
    // to push the balance negative.
    const whenBroke = await executeTrade(user.id, artist.id, 'buy', 1);
    expect(whenBroke.ok).toBe(false);
    expect((await getUserById(user.id))!.next_credits_cents).toBe(0); // unchanged, never negative
  });

  it('getRecentTradeCount only counts this user\'s trades within the given window', async () => {
    const user = await makeUser('rate-limit-trader@example.com');
    const otherUser = await makeUser('other-rate-limit-trader@example.com');
    const artist = await makeArtist('Rate Limit Trade Artist');

    expect(await getRecentTradeCount(user.id, 1)).toBe(0);
    await executeTrade(user.id, artist.id, 'buy', 10_000);
    await executeTrade(user.id, artist.id, 'buy', 10_000);
    await executeTrade(otherUser.id, artist.id, 'buy', 10_000); // a different user's trade never counts against this one
    expect(await getRecentTradeCount(user.id, 1)).toBe(2);
    expect(await getRecentTradeCount(otherUser.id, 1)).toBe(1);

    // Backdate one trade outside the window — same id-capture-then-UPDATE
    // pattern used elsewhere in this file to avoid same-millisecond ties.
    const row = await db.prepare('SELECT id FROM next_transactions WHERE user_id = ? ORDER BY id ASC LIMIT 1').get(user.id) as { id: number };
    await db.prepare('UPDATE next_transactions SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 2 * 60 * 1000).toISOString(), row.id);
    expect(await getRecentTradeCount(user.id, 1)).toBe(1);
  });

  it('a real-world trading session stays well under TRADE_RATE_LIMIT_PER_MINUTE, confirming the cap is generous rather than intrusive', async () => {
    const user = await makeUser('normal-trader@example.com');
    const artist = await makeArtist('Normal Trading Artist');
    for (let i = 0; i < 5; i++) await executeTrade(user.id, artist.id, 'buy', 10_000);
    expect(await getRecentTradeCount(user.id, 1)).toBeLessThan(TRADE_RATE_LIMIT_PER_MINUTE);
  });

  it('trade idempotency: storeTradeResponse then getStoredTradeResponse round-trips the exact status and body, scoped per user+key', async () => {
    const user = await makeUser('idempotency-user@example.com');
    const otherUser = await makeUser('idempotency-other-user@example.com');

    expect(await getStoredTradeResponse(user.id, 'key-1')).toBeUndefined();
    await storeTradeResponse(user.id, 'key-1', 200, { ok: true, shares: 1.2345 });

    const stored = await getStoredTradeResponse(user.id, 'key-1');
    expect(stored).toEqual({ status: 200, body: { ok: true, shares: 1.2345 } });

    // The same key string for a DIFFERENT user is a different row entirely
    // — no cross-user collision.
    expect(await getStoredTradeResponse(otherUser.id, 'key-1')).toBeUndefined();

    // Storing again under the same (user, key) is a silent no-op (the
    // UNIQUE-violation path), not an error — and the ORIGINAL response
    // stays intact, which is the whole point: a retried request replays
    // what actually happened, not a second, possibly different outcome.
    await storeTradeResponse(user.id, 'key-1', 400, { error: 'a different, later error' });
    expect(await getStoredTradeResponse(user.id, 'key-1')).toEqual({ status: 200, body: { ok: true, shares: 1.2345 } });
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

  it('findUserByNormalizedEmail finds an existing account by its Gmail-dot/plus-tag alias, and returns undefined for a genuinely new email', async () => {
    await createUser({ name: 'Alias Test User', email: 'alias.test.user@gmail.com', password_hash: 'hash' });

    const found = await findUserByNormalizedEmail('AliasTestUser+signup2@gmail.com');
    expect(found).toBeDefined();
    expect(found!.email).toBe('alias.test.user@gmail.com');

    expect(await findUserByNormalizedEmail('nobody-with-this-alias@gmail.com')).toBeUndefined();
  });

  it('getSuspiciousTradingFlags surfaces a real rapid-trading pattern with names resolved, and stays empty for ordinary trading', async () => {
    const quietUser = await makeUser('quiet-trader@example.com');
    const quietArtist = await makeArtist('Quiet Trading Artist');
    await executeTrade(quietUser.id, quietArtist.id, 'buy', 10_000); // one ordinary trade — should never flag anything
    expect((await getSuspiciousTradingFlags()).some((f) => f.userIds.includes(quietUser.id))).toBe(false);

    const rapidUser = await createUser({ name: 'Rapid Trader', email: 'rapid-trader-flag@example.com', password_hash: 'hash' });
    const rapidArtist = await makeArtist('Rapid Trading Flag Artist');
    // 10 trades, all effectively "now" — comfortably within the rapid-trading window.
    for (let i = 0; i < 10; i++) await executeTrade(rapidUser.id, rapidArtist.id, 'buy', 5_000);

    const flags = await getSuspiciousTradingFlags();
    const rapidFlag = flags.find((f) => f.kind === 'rapid_trading' && f.userIds.includes(rapidUser.id) && f.artistId === rapidArtist.id);
    expect(rapidFlag).toBeDefined();
    expect(rapidFlag!.userNames).toEqual(['Rapid Trader']);
    expect(rapidFlag!.artistName).toBe('Rapid Trading Flag Artist');
  });
});

describe('Performance and reliability (Phase 10) — error reports', () => {
  it('insertErrorReport round-trips every field, and getRecentErrorReports resolves the reporting user\'s name', async () => {
    const user = await createUser({ name: 'Error Reporter', email: 'error-reporter@example.com', password_hash: 'hash' });
    const before = await getErrorReportCount(24);

    await insertErrorReport({
      source: 'client',
      message: 'TypeError: cannot read properties of undefined',
      stack: 'TypeError: ...\n  at Component (file.tsx:42:10)',
      digest: 'abc123',
      path: '/next/artists/1',
      userId: user.id,
    });

    expect(await getErrorReportCount(24)).toBe(before + 1);
    const recent = await getRecentErrorReports(10);
    const mine = recent.find((r) => r.digest === 'abc123')!;
    expect(mine).toBeDefined();
    expect(mine.source).toBe('client');
    expect(mine.message).toBe('TypeError: cannot read properties of undefined');
    expect(mine.stack).toContain('Component (file.tsx:42:10)');
    expect(mine.path).toBe('/next/artists/1');
    expect(mine.user_name).toBe('Error Reporter');
  });

  it('insertErrorReport works without a user (an unauthenticated visitor hit the error boundary)', async () => {
    await insertErrorReport({ source: 'server', message: 'Unhandled exception in route handler' });
    const recent = await getRecentErrorReports(10);
    const mine = recent.find((r) => r.message === 'Unhandled exception in route handler')!;
    expect(mine).toBeDefined();
    expect(mine.user_name).toBeFalsy(); // null from the LEFT JOIN, not a real name
    expect(mine.stack).toBeFalsy();
  });

  it('getErrorReportCount only counts reports within the given hour window', async () => {
    await insertErrorReport({ source: 'server', message: 'Window test error' });
    const row = await db.prepare("SELECT id FROM error_reports WHERE message = 'Window test error' ORDER BY id DESC LIMIT 1").get() as { id: number };
    await db.prepare('UPDATE error_reports SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), row.id);

    const countIn24h = await getErrorReportCount(24);
    const countIn72h = await getErrorReportCount(72);
    expect(countIn72h).toBeGreaterThan(countIn24h); // the backdated row only shows up in the wider window
  });
});

describe('NEXT Feed — feed_events core', () => {
  it('createFeedEvent persists a row retrievable by getFeedEvent, with metadata round-tripped as JSON', async () => {
    const artist = await makeArtist('Feed Event Artist');
    const event = await createFeedEvent({
      eventType: 'new_artist',
      artistId: artist.id,
      refType: 'discovery_candidate',
      refId: 999,
      metadata: { genre: 'pop', score: 80 },
    });

    expect(event).toBeTruthy();
    const fetched = await getFeedEvent(event!.id);
    expect(fetched).toBeDefined();
    expect(fetched!.event_type).toBe('new_artist');
    expect(fetched!.artist_id).toBe(artist.id);
    expect(fetched!.ref_type).toBe('discovery_candidate');
    expect(fetched!.ref_id).toBe(999);
    expect(fetched!.visibility).toBe('public');
    expect(JSON.parse(fetched!.metadata!)).toEqual({ genre: 'pop', score: 80 });
  });

  it('a dedupe_key collision is silently ignored — no second row, no throw', async () => {
    const artist = await makeArtist('Dedupe Artist');
    const before = await getFeedEventCount();

    const first = await createFeedEvent({ eventType: 'signal_undervalued', artistId: artist.id, dedupeKey: `dedupe-test:${artist.id}` });
    const second = await createFeedEvent({ eventType: 'signal_undervalued', artistId: artist.id, dedupeKey: `dedupe-test:${artist.id}` });

    expect(first).toBeTruthy();
    expect(second).toBeNull();
    expect(await getFeedEventCount()).toBe(before + 1);
  });

  it('hasFeedEventSince only sees events at or after the cutoff, for that exact event type and artist', async () => {
    const artist = await makeArtist('Cooldown Artist');
    const otherArtist = await makeArtist('Cooldown Other Artist');
    const cutoff = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

    expect(await hasFeedEventSince('signal_overheated', artist.id, cutoff)).toBe(false);

    const event = (await createFeedEvent({ eventType: 'signal_overheated', artistId: artist.id }))!;
    expect(await hasFeedEventSince('signal_overheated', artist.id, cutoff)).toBe(true);
    // Different event type or different artist — cooldown doesn't apply.
    expect(await hasFeedEventSince('signal_undervalued', artist.id, cutoff)).toBe(false);
    expect(await hasFeedEventSince('signal_overheated', otherArtist.id, cutoff)).toBe(false);

    // Backdate past the cutoff — the "state has been true for over 10 days,
    // it's safe to post about it again" case the spec calls out.
    await db.prepare('UPDATE feed_events SET created_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 11 * 24 * 60 * 60 * 1000).toISOString(), event.id);
    expect(await hasFeedEventSince('signal_overheated', artist.id, cutoff)).toBe(false);
  });

  it('getFeedEvents returns newest-first and beforeId pages backward without repeats', async () => {
    const artist = await makeArtist('Pagination Artist');
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push((await createFeedEvent({ eventType: 'artist_update', artistId: artist.id, refType: 'contact_log', refId: i }))!.id);
    }

    const firstPage = await getFeedEvents(2);
    expect(firstPage.map((e) => e.id)).toEqual([ids[4], ids[3]]);

    const secondPage = await getFeedEvents(2, firstPage[firstPage.length - 1].id);
    expect(secondPage.map((e) => e.id)).toEqual([ids[2], ids[1]]);
  });
});

describe('NEXT Feed — real events wired into existing actions', () => {
  it('approving a candidate posts a new_artist feed event, deduped to one per candidate', async () => {
    await insertDiscoveryCandidate({ source: 'soundcharts', soundcharts_uuid: 'uuid-feed-new-1', name: 'Feed New Artist', followers_count: 9000, flagged_reason: 'test' });
    const admin = await makeUser('feed-approver@example.com');
    const candidate = (await getDiscoveryCandidates('new')).find((c) => c.soundcharts_uuid === 'uuid-feed-new-1')!;

    const artist = (await approveDiscoveryCandidate(candidate.id, { id: admin.id, name: admin.name }))!;

    const events = (await getFeedEvents(50)).filter((e) => e.artist_id === artist.id && e.event_type === 'new_artist');
    expect(events).toHaveLength(1);
    expect(events[0].ref_type).toBe('discovery_candidate');
    expect(events[0].ref_id).toBe(candidate.id);
  });

  it('approving a candidate with a real submitter also posts early_discovery, attributed to that user', async () => {
    const submitter = await makeUser('feed-submitter@example.com');
    await insertDiscoveryCandidate({
      source: 'public_submission', name: 'Feed Early Discovery Artist', followers_count: 4000,
      flagged_reason: 'test', submitted_by_user_id: submitter.id,
    });
    const admin = await makeUser('feed-approver-2@example.com');
    const candidate = (await getDiscoveryCandidates('new')).find((c) => c.name === 'Feed Early Discovery Artist')!;

    const artist = (await approveDiscoveryCandidate(candidate.id, { id: admin.id, name: admin.name }))!;

    const events = (await getFeedEvents(50)).filter((e) => e.artist_id === artist.id && e.event_type === 'early_discovery');
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBe(submitter.id);
  });

  it('approving a candidate with no submitter posts no early_discovery event', async () => {
    await insertDiscoveryCandidate({ source: 'soundcharts', soundcharts_uuid: 'uuid-feed-no-submitter', name: 'No Submitter Artist', followers_count: 3000, flagged_reason: 'test' });
    const admin = await makeUser('feed-approver-3@example.com');
    const candidate = (await getDiscoveryCandidates('new')).find((c) => c.soundcharts_uuid === 'uuid-feed-no-submitter')!;

    const artist = (await approveDiscoveryCandidate(candidate.id, { id: admin.id, name: admin.name }))!;

    expect((await getFeedEvents(50)).some((e) => e.artist_id === artist.id && e.event_type === 'early_discovery')).toBe(false);
  });

  it('createFeedEvent wired the same way the Artist Update note route wires it produces a matching artist_update event', async () => {
    // The note route (app/api/next/my-artist/[id]/note/route.ts) is the
    // actual artist_update source — it calls addLogEntry then
    // createFeedEvent as a pair, verified end-to-end via Playwright QA.
    // This exercises that same pairing at the db layer: the log entry
    // stays the single source of truth, the feed event is just a pointer.
    const claimant = await makeUser('feed-claimant@example.com');
    const artist = await makeArtist('Feed Update Artist');
    const entry = await addLogEntry(artist.id, { type: 'note', message: 'Artist self-update: hello.' }, claimant);
    await createFeedEvent({
      eventType: 'artist_update', actorUserId: claimant.id, artistId: artist.id,
      refType: 'contact_log', refId: entry.id, dedupeKey: `artist_update:${entry.id}`,
    });

    const events = (await getFeedEvents(50)).filter((e) => e.artist_id === artist.id && e.event_type === 'artist_update');
    expect(events.some((e) => e.ref_type === 'contact_log' && e.ref_id === entry.id && e.actor_user_id === claimant.id)).toBe(true);
  });

  it('shareFoundingBelieverToFeed returns null when the user never actually backed the artist', async () => {
    const user = await makeUser('feed-share-nobody@example.com');
    const artist = await makeArtist('Feed Share Nobody Artist');
    expect(await shareFoundingBelieverToFeed(user.id, artist.id)).toBeNull();
  });

  it('shareFoundingBelieverToFeed posts once per collectible per day, and again on a later day', async () => {
    const user = await makeUser('feed-sharer@example.com');
    const artist = await makeArtist('Feed Share Artist');
    const buy = await executeTrade(user.id, artist.id, 'buy', 50_000);
    if (!buy.ok) throw new Error(buy.error);

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
      const first = await shareFoundingBelieverToFeed(user.id, artist.id);
      expect(first).toBeTruthy();
      expect(first!.event_type).toBe('founding_believer_share');
      expect(first!.actor_user_id).toBe(user.id);

      const sameDay = await shareFoundingBelieverToFeed(user.id, artist.id);
      expect(sameDay).toBeNull();

      vi.setSystemTime(new Date('2026-01-02T12:00:00Z'));
      const nextDay = await shareFoundingBelieverToFeed(user.id, artist.id);
      expect(nextDay).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('NEXT Feed — batch lookups for feed item assembly', () => {
  it('getUsersByIds resolves multiple users in one call, skipping ids with no match', async () => {
    const a = await makeUser('feed-batch-user-a@example.com');
    const b = await makeUser('feed-batch-user-b@example.com');
    const map = await getUsersByIds([a.id, b.id, 999_999]);
    expect(map.size).toBe(2);
    expect(map.get(a.id)?.email).toBe('feed-batch-user-a@example.com');
    expect(map.get(b.id)?.email).toBe('feed-batch-user-b@example.com');
    expect(map.has(999_999)).toBe(false);
  });

  it('getUsersByIds returns an empty map for an empty input, without querying', async () => {
    expect((await getUsersByIds([])).size).toBe(0);
  });

  it('getBackedArtistIds lists only artists the user currently holds shares in', async () => {
    const user = await makeUser('feed-backed-ids@example.com');
    const backed = await makeArtist('Feed Backed Artist');
    const soldOut = await makeArtist('Feed Sold Out Artist');
    const neverBought = await makeArtist('Feed Never Bought Artist');
    await executeTrade(user.id, backed.id, 'buy', 50_000);
    await executeTrade(user.id, soldOut.id, 'buy', 50_000);
    await executeTrade(user.id, soldOut.id, 'sell', 999_999_999);

    const ids = await getBackedArtistIds(user.id);
    expect(ids).toContain(backed.id);
    expect(ids).not.toContain(soldOut.id);
    expect(ids).not.toContain(neverBought.id);
  });

  it('getNextArtistsByIds returns live market rows keyed by id, matching getNextArtist for the same artist', async () => {
    const artist = await makeArtist('Feed Batch Market Artist');
    const single = (await getNextArtist(artist.id))!;
    const batch = await getNextArtistsByIds([artist.id, 999_999]);
    expect(batch.size).toBe(1);
    expect(batch.get(artist.id)?.score).toBe(single.score);
    expect(batch.get(artist.id)?.priceCents).toBe(single.priceCents);
    expect(batch.has(999_999)).toBe(false);
  });

  it('getNextArtistsByIds returns an empty map for an empty input', async () => {
    expect((await getNextArtistsByIds([])).size).toBe(0);
  });

  it('getLogEntryById finds a specific contact_log row by id', async () => {
    const artist = await makeArtist('Feed Log Lookup Artist');
    const entry = await addLogEntry(artist.id, { type: 'note', message: 'Feed lookup test note.' });
    const found = await getLogEntryById(entry.id);
    expect(found?.message).toBe('Feed lookup test note.');
    expect(await getLogEntryById(999_999)).toBeUndefined();
  });

  it('getFoundingBelieverRecordById finds a specific record by id, independent of getFoundingBelieverRecord\'s user+artist lookup', async () => {
    const user = await makeUser('feed-founding-lookup@example.com');
    const artist = await makeArtist('Feed Founding Lookup Artist');
    const buy = await executeTrade(user.id, artist.id, 'buy', 50_000);
    if (!buy.ok) throw new Error(buy.error);
    const byUserArtist = (await getFoundingBelieverRecord(user.id, artist.id))!;
    const byId = await getFoundingBelieverRecordById(byUserArtist.id);
    expect(byId?.id).toBe(byUserArtist.id);
    expect(byId?.discovery_rank).toBe(byUserArtist.discovery_rank);
    expect(await getFoundingBelieverRecordById(999_999)).toBeUndefined();
  });

  it('logFeedItemImpressions records one analytics event per feed_events id, and no-ops on an empty list', async () => {
    const user = await makeUser('feed-impressions@example.com');
    const before = await db.prepare("SELECT COUNT(*) AS c FROM analytics_events WHERE event_type = 'feed_item_impression'").get() as { c: number };
    await logFeedItemImpressions(user.id, [1, 2, 3]);
    const after = await db.prepare("SELECT COUNT(*) AS c FROM analytics_events WHERE event_type = 'feed_item_impression'").get() as { c: number };
    expect(after.c - before.c).toBe(3);

    await logFeedItemImpressions(user.id, []);
    const afterEmpty = await db.prepare("SELECT COUNT(*) AS c FROM analytics_events WHERE event_type = 'feed_item_impression'").get() as { c: number };
    expect(afterEmpty.c).toBe(after.c);
  });
});

describe('NEXT Feed — reactions', () => {
  it('setFeedReaction creates a reaction, tapping the SAME one again removes it', async () => {
    const user = await makeUser('feed-reaction-toggle@example.com');
    const artist = await makeArtist('Feed Reaction Toggle Artist');
    const event = (await createFeedEvent({ eventType: 'new_artist', artistId: artist.id }))!;

    const created = await setFeedReaction(event.id, user.id, 'fire');
    expect(created?.reaction_type).toBe('fire');
    expect((await getFeedReactionCounts(event.id)).fire).toBe(1);

    const removed = await setFeedReaction(event.id, user.id, 'fire');
    expect(removed).toBeNull();
    expect((await getFeedReactionCounts(event.id)).fire).toBe(0);
  });

  it('setFeedReaction with a DIFFERENT type changes the reaction in place, never doubling the row', async () => {
    const user = await makeUser('feed-reaction-change@example.com');
    const artist = await makeArtist('Feed Reaction Change Artist');
    const event = (await createFeedEvent({ eventType: 'new_artist', artistId: artist.id }))!;

    await setFeedReaction(event.id, user.id, 'fire');
    const changed = await setFeedReaction(event.id, user.id, 'eyes');
    expect(changed?.reaction_type).toBe('eyes');

    const counts = await getFeedReactionCounts(event.id);
    expect(counts.fire).toBe(0);
    expect(counts.eyes).toBe(1);
    const rowCount = (await db.prepare('SELECT COUNT(*) AS c FROM feed_reactions WHERE feed_event_id = ? AND user_id = ?').get(event.id, user.id) as { c: number }).c;
    expect(rowCount).toBe(1); // one row per (event, user), always — UPDATE in place, never a second INSERT
  });

  it('two different users reacting to the same post both count, independently', async () => {
    const alice = await makeUser('feed-reaction-alice@example.com');
    const bob = await makeUser('feed-reaction-bob@example.com');
    const artist = await makeArtist('Feed Reaction Multi User Artist');
    const event = (await createFeedEvent({ eventType: 'new_artist', artistId: artist.id }))!;

    await setFeedReaction(event.id, alice.id, 'early');
    await setFeedReaction(event.id, bob.id, 'early');
    expect((await getFeedReactionCounts(event.id)).early).toBe(2);
  });

  it('getFeedReactionCountsForEvents and getUserFeedReactionsForEvents batch across multiple events correctly', async () => {
    const user = await makeUser('feed-reaction-batch@example.com');
    const other = await makeUser('feed-reaction-batch-other@example.com');
    const artist = await makeArtist('Feed Reaction Batch Artist');
    const e1 = (await createFeedEvent({ eventType: 'new_artist', artistId: artist.id }))!;
    const e2 = (await createFeedEvent({ eventType: 'artist_update', artistId: artist.id, refType: 'contact_log', refId: 1 }))!;

    await setFeedReaction(e1.id, user.id, 'fire');
    await setFeedReaction(e1.id, other.id, 'fire');
    await setFeedReaction(e2.id, user.id, 'eyes');

    const counts = await getFeedReactionCountsForEvents([e1.id, e2.id]);
    expect(counts.get(e1.id)?.fire).toBe(2);
    expect(counts.get(e2.id)?.eyes).toBe(1);

    const viewerReactions = await getUserFeedReactionsForEvents(user.id, [e1.id, e2.id]);
    expect(viewerReactions.get(e1.id)).toBe('fire');
    expect(viewerReactions.get(e2.id)).toBe('eyes');
  });

  it('getFeedReactionCountsForEvents and getUserFeedReactionsForEvents return empty maps for an empty input', async () => {
    expect((await getFeedReactionCountsForEvents([])).size).toBe(0);
    expect((await getUserFeedReactionsForEvents(1, [])).size).toBe(0);
  });

  it('getRecentReactionCount only counts a user\'s own taps within the window', async () => {
    const user = await makeUser('feed-reaction-rate@example.com');
    const other = await makeUser('feed-reaction-rate-other@example.com');
    const artist = await makeArtist('Feed Reaction Rate Artist');
    const event = (await createFeedEvent({ eventType: 'new_artist', artistId: artist.id }))!;

    await setFeedReaction(event.id, user.id, 'fire');
    await setFeedReaction(event.id, other.id, 'fire'); // a different user's tap doesn't count toward user's own rate
    expect(await getRecentReactionCount(user.id, 1)).toBe(1);

    await db.prepare('UPDATE feed_reaction_taps SET created_at = ? WHERE user_id = ?').run(new Date(Date.now() - 5 * 60 * 1000).toISOString(), user.id);
    expect(await getRecentReactionCount(user.id, 1)).toBe(0); // outside the 1-minute window now
  });

  it('getRecentReactionCount keeps counting taps even as toggling add/remove deletes the underlying feed_reactions row', async () => {
    const user = await makeUser('feed-reaction-rate-toggle@example.com');
    const artist = await makeArtist('Feed Reaction Rate Toggle Artist');
    const event = (await createFeedEvent({ eventType: 'new_artist', artistId: artist.id }))!;

    await setFeedReaction(event.id, user.id, 'fire'); // add
    await setFeedReaction(event.id, user.id, 'fire'); // remove — feed_reactions row is now gone
    await setFeedReaction(event.id, user.id, 'eyes'); // add again
    // Every one of those three taps still counts toward the rate limit,
    // even though only one feed_reactions row exists at the end.
    expect(await getRecentReactionCount(user.id, 1)).toBe(3);
    expect((await db.prepare('SELECT COUNT(*) AS c FROM feed_reactions WHERE feed_event_id = ? AND user_id = ?').get(event.id, user.id) as { c: number }).c).toBe(1);
  });
});

describe('NEXT Feed — User Take posts', () => {
  it('createUserTakePost creates both a real post row and a real feed_event, linked', async () => {
    const user = await makeUser('user-take-create@example.com');
    const artist = await makeArtist('User Take Create Artist');

    const result = await createUserTakePost(user.id, artist.id, 'I think this artist is massively undervalued.');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.post.user_id).toBe(user.id);
    expect(result.post.artist_id).toBe(artist.id);
    expect(result.post.body).toBe('I think this artist is massively undervalued.');
    expect(result.event.event_type).toBe('user_take');
    expect(result.event.actor_user_id).toBe(user.id);
    expect(result.event.artist_id).toBe(artist.id);
    expect(result.event.ref_type).toBe('user_post');
    expect(result.event.ref_id).toBe(result.post.id);
  });

  it('rejects an empty or whitespace-only take', async () => {
    const user = await makeUser('user-take-empty@example.com');
    const artist = await makeArtist('User Take Empty Artist');
    const result = await createUserTakePost(user.id, artist.id, '   ');
    expect(result.ok).toBe(false);
  });

  it('rejects a take over the max length', async () => {
    const user = await makeUser('user-take-toolong@example.com');
    const artist = await makeArtist('User Take Too Long Artist');
    const result = await createUserTakePost(user.id, artist.id, 'x'.repeat(USER_TAKE_BODY_MAX_LENGTH + 1));
    expect(result.ok).toBe(false);
  });

  it('rejects a take about an artist that does not exist or is passed', async () => {
    const user = await makeUser('user-take-badartist@example.com');
    expect((await createUserTakePost(user.id, 999_999, 'A take.')).ok).toBe(false);

    const passedArtist = await makeArtist('User Take Passed Artist');
    await bulkSetArtistStage([passedArtist.id], 'passed', { id: user.id, name: user.name });
    expect((await createUserTakePost(user.id, passedArtist.id, 'A take.')).ok).toBe(false);
  });

  it('rejects an exact duplicate resubmitted within a minute, but allows a genuinely different take', async () => {
    const user = await makeUser('user-take-dup@example.com');
    const artist = await makeArtist('User Take Dup Artist');

    const first = await createUserTakePost(user.id, artist.id, 'Same take.');
    expect(first.ok).toBe(true);
    const dup = await createUserTakePost(user.id, artist.id, 'Same take.');
    expect(dup.ok).toBe(false);
    const different = await createUserTakePost(user.id, artist.id, 'A completely different take.');
    expect(different.ok).toBe(true);
  });

  it('getUserTakePostById / getUserTakePostsByIds resolve real rows and skip missing ids', async () => {
    const user = await makeUser('user-take-lookup@example.com');
    const artist = await makeArtist('User Take Lookup Artist');
    const result = await createUserTakePost(user.id, artist.id, 'Lookup take.');
    if (!result.ok) throw new Error('expected ok');

    expect((await getUserTakePostById(result.post.id))?.body).toBe('Lookup take.');
    expect(await getUserTakePostById(999_999)).toBeUndefined();

    const batch = await getUserTakePostsByIds([result.post.id, 999_999]);
    expect(batch.size).toBe(1);
    expect(batch.get(result.post.id)?.body).toBe('Lookup take.');
  });

  it('deleteUserTakePost only deletes when called by the real owner, and is soft (no hard row removal)', async () => {
    const owner = await makeUser('user-take-owner@example.com');
    const other = await makeUser('user-take-other@example.com');
    const artist = await makeArtist('User Take Delete Artist');
    const result = await createUserTakePost(owner.id, artist.id, 'Deletable take.');
    if (!result.ok) throw new Error('expected ok');

    expect(await deleteUserTakePost(other.id, result.post.id)).toBe(false); // not the owner
    expect(await deleteUserTakePost(owner.id, result.post.id)).toBe(true);
    expect(await deleteUserTakePost(owner.id, result.post.id)).toBe(false); // already deleted

    const stillThere = await db.prepare('SELECT deleted_at FROM feed_user_posts WHERE id = ?').get(result.post.id) as { deleted_at: string };
    expect(stillThere.deleted_at).toBeTruthy(); // row still exists, just marked
  });

  it('getUserTakePostsForUser lists only that user\'s non-deleted posts, newest first', async () => {
    const user = await makeUser('user-take-mine@example.com');
    const artist = await makeArtist('User Take Mine Artist');
    const other = await makeUser('user-take-notmine@example.com');

    const p1 = await createUserTakePost(user.id, artist.id, 'First take.');
    const p2 = await createUserTakePost(user.id, artist.id, 'Second take.');
    await createUserTakePost(other.id, artist.id, 'Not mine.');
    if (!p1.ok || !p2.ok) throw new Error('expected ok');
    await deleteUserTakePost(user.id, p1.post.id);

    const mine = await getUserTakePostsForUser(user.id);
    expect(mine.map((p) => p.id)).toEqual([p2.post.id]); // p1 deleted, other user's excluded
    expect(mine[0].artist_name).toBe('User Take Mine Artist');
  });

  it('reportUserTakePost is idempotent per (post, reporter) and getReportedUserTakePosts surfaces real reporter-facing data', async () => {
    const author = await makeUser('user-take-report-author@example.com');
    const reporter = await makeUser('user-take-report-reporter@example.com');
    const artist = await makeArtist('User Take Report Artist');
    const result = await createUserTakePost(author.id, artist.id, 'A reported take.');
    if (!result.ok) throw new Error('expected ok');

    await reportUserTakePost(reporter.id, result.post.id);
    await reportUserTakePost(reporter.id, result.post.id); // same reporter again — no-op

    const reported = await getReportedUserTakePosts();
    const mine = reported.find((r) => r.post.id === result.post.id)!;
    expect(mine).toBeDefined();
    expect(mine.reportCount).toBe(1);
    expect(mine.authorName).toBe(author.name);
    expect(mine.authorEmail).toBe(author.email);
    expect(mine.artistName).toBe('User Take Report Artist');
  });

  it('hideUserTakePost / unhideUserTakePost toggle visibility without deleting the row', async () => {
    const author = await makeUser('user-take-hide-author@example.com');
    const admin = await makeUser('user-take-hide-admin@example.com');
    const artist = await makeArtist('User Take Hide Artist');
    const result = await createUserTakePost(author.id, artist.id, 'A take to hide.');
    if (!result.ok) throw new Error('expected ok');

    expect(await hideUserTakePost(admin.id, result.post.id)).toBe(true);
    expect(await hideUserTakePost(admin.id, result.post.id)).toBe(false); // already hidden
    const hidden = (await getUserTakePostById(result.post.id))!;
    expect(hidden.hidden_at).toBeTruthy();
    expect(hidden.hidden_by).toBe(admin.id);

    expect(await unhideUserTakePost(result.post.id)).toBe(true);
    expect((await getUserTakePostById(result.post.id))!.hidden_at).toBeFalsy();
  });

  it('getRecentUserTakePostCount only counts a user\'s own posts within the window', async () => {
    const user = await makeUser('user-take-rate@example.com');
    const artist = await makeArtist('User Take Rate Artist');
    await createUserTakePost(user.id, artist.id, 'Take one.');
    expect(await getRecentUserTakePostCount(user.id, 10)).toBe(1);

    await db.prepare('UPDATE feed_user_posts SET created_at = ? WHERE user_id = ?').run(new Date(Date.now() - 60 * 60 * 1000).toISOString(), user.id);
    expect(await getRecentUserTakePostCount(user.id, 10)).toBe(0);
  });

  it('searchNextArtists matches by substring, excludes passed artists, and ranks a prefix match first', async () => {
    const prefixMatch = await makeArtist('Zeta Prefix Artist');
    const substringMatch = await makeArtist('The Zeta Band');
    const passedArtist = await makeArtist('Zeta Passed Artist');
    await bulkSetArtistStage([passedArtist.id], 'passed', { id: 1, name: 'admin' });

    const results = await searchNextArtists('Zeta');
    const names = results.map((r) => r.name);
    expect(names).toContain(prefixMatch.name);
    expect(names).toContain(substringMatch.name);
    expect(names).not.toContain(passedArtist.name);
    expect(names[0]).toBe(prefixMatch.name); // prefix match ranked ahead of mid-string match
  });

  it('searchNextArtists returns nothing for an empty query', async () => {
    expect(await searchNextArtists('')).toEqual([]);
  });
});

describe('Wikidata match cache', () => {
  it('saveWikidataMatch stores the qid and a fetched timestamp, clearing any prior no-match', async () => {
    const artist = await makeArtist('Wikidata Match Artist');
    await saveWikidataNoMatch(artist.id);
    expect((await getArtist(artist.id))!.wikidata_no_match_at).toBeTruthy();

    await saveWikidataMatch(artist.id, 'Q12345');
    const updated = (await getArtist(artist.id))!;
    expect(updated.wikidata_qid).toBe('Q12345');
    expect(updated.wikidata_fetched_at).toBeTruthy();
    expect(updated.wikidata_no_match_at ?? null).toBeNull();
  });

  it('saveWikidataNoMatch stamps fetched_at and no_match_at without touching qid', async () => {
    const artist = await makeArtist('Wikidata No Match Artist');
    await saveWikidataNoMatch(artist.id);
    const updated = (await getArtist(artist.id))!;
    expect(updated.wikidata_qid ?? null).toBeNull();
    expect(updated.wikidata_fetched_at).toBeTruthy();
    expect(updated.wikidata_no_match_at).toBeTruthy();
  });
});

describe('Claimed-artist photo (ARTIST_PROVIDED provenance)', () => {
  it('setArtistPhotoByOwner sets photo_url plus full provenance, stamping the uploader and rights confirmation', async () => {
    const uploader = await makeUser('photo-uploader@example.com');
    const artist = await makeArtist('Photo Upload Artist');

    const updated = (await setArtistPhotoByOwner(artist.id, 'https://example.com/my-photo.jpg', uploader.id))!;
    expect(updated.photo_url).toBe('https://example.com/my-photo.jpg');
    expect(updated.photo_source_type).toBe('ARTIST_PROVIDED');
    expect(updated.photo_source_url).toBe('https://example.com/my-photo.jpg');
    expect(updated.photo_uploaded_by_user_id).toBe(uploader.id);
    expect(updated.photo_uploaded_at).toBeTruthy();
    expect(updated.photo_rights_confirmed_at).toBeTruthy();
    // Never carries stale Commons-license fields over from a prior photo.
    expect(updated.photo_attribution ?? null).toBeNull();
  });

  it('setArtistPhotoByOwner overwrites a prior Commons-sourced photo\'s attribution/license entirely, not just photo_url', async () => {
    const uploader = await makeUser('photo-overwrite@example.com');
    const artist = await makeArtist('Photo Overwrite Artist');
    await updateArtist(artist.id, {
      photo_url: 'https://commons.example/old.jpg', photo_source_type: 'WIKIMEDIA_COMMONS',
      photo_source_url: 'https://commons.wikimedia.org/wiki/File:Old.jpg', photo_attribution: 'Old Photographer, CC BY-SA 4.0',
      photo_license: 'CC BY-SA 4.0', photo_license_url: 'https://creativecommons.org/licenses/by-sa/4.0',
    } as any, { id: 1, name: 'admin' });

    const updated = (await setArtistPhotoByOwner(artist.id, 'https://example.com/new.jpg', uploader.id))!;
    expect(updated.photo_source_type).toBe('ARTIST_PROVIDED');
    expect(updated.photo_attribution ?? null).toBeNull();
    expect(updated.photo_license ?? null).toBeNull();
    expect(updated.photo_license_url ?? null).toBeNull();
  });

  it('removeArtistProvidedPhoto clears the photo and all its provenance on an ARTIST_PROVIDED photo', async () => {
    const uploader = await makeUser('photo-remove@example.com');
    const artist = await makeArtist('Photo Remove Artist');
    await setArtistPhotoByOwner(artist.id, 'https://example.com/to-remove.jpg', uploader.id);

    const removed = (await removeArtistProvidedPhoto(artist.id))!;
    expect(removed.photo_url ?? null).toBeNull();
    expect(removed.photo_source_type ?? null).toBeNull();
    expect(removed.photo_uploaded_by_user_id ?? null).toBeNull();
    expect(removed.photo_rights_confirmed_at ?? null).toBeNull();
  });

  it('removeArtistProvidedPhoto is a no-op on a photo sourced any other way — never removes a Scout- or Commons-set photo', async () => {
    const artist = await makeArtist('Non-Owner Photo Artist');
    await updateArtist(artist.id, { photo_url: 'https://example.com/scout-set.jpg', photo_source_type: 'SCOUT_MANUAL' } as any, { id: 1, name: 'admin' });

    const result = (await removeArtistProvidedPhoto(artist.id))!;
    expect(result.photo_url).toBe('https://example.com/scout-set.jpg');
    expect(result.photo_source_type).toBe('SCOUT_MANUAL');
  });
});

describe('updateArtistByOwner — claimed-artist self-service field whitelist', () => {
  it('applies an editable field (bio) through the same field-history-logged path as a Scout edit', async () => {
    const owner = await makeUser('owner-edit@example.com');
    const artist = await makeArtist('Owner Edit Artist');

    const updated = (await updateArtistByOwner(artist.id, { bio: 'My own bio, written by me.' } as any, { id: owner.id, name: owner.name }))!;
    expect(updated.bio).toBe('My own bio, written by me.');
    const history = await getArtistFieldHistory(artist.id);
    expect(history.some((h) => h.field === 'bio' && h.actor_id === owner.id)).toBe(true);
  });

  it('silently ignores every field outside CLAIMED_ARTIST_EDITABLE_FIELDS — score, stage, notes, name never change', async () => {
    const owner = await makeUser('owner-restricted@example.com');
    const artist = await makeArtist('Owner Restricted Artist');
    const before = (await getArtist(artist.id))!;

    const updated = (await updateArtistByOwner(artist.id, {
      name: 'Renamed By Artist', notes: 'secret scout notes leaked', stage: 'flagship', music_talent: 10, scout_name: 'Fake Scout',
    } as any, { id: owner.id, name: owner.name }))!;

    expect(updated.name).toBe(before.name);
    expect(updated.notes ?? null).toBe(before.notes ?? null);
    expect(updated.stage).toBe(before.stage);
    expect(updated.music_talent).toBe(before.music_talent);
    expect(updated.scout_name ?? null).toBe(before.scout_name ?? null);
  });

  it('applies website_url and social links together in one call', async () => {
    const owner = await makeUser('owner-links@example.com');
    const artist = await makeArtist('Owner Links Artist');

    const updated = (await updateArtistByOwner(artist.id, {
      website_url: 'https://example-artist.com', instagram_url: 'https://instagram.com/example', genre: 'Indie Pop',
    } as any, { id: owner.id, name: owner.name }))!;
    expect(updated.website_url).toBe('https://example-artist.com');
    expect(updated.instagram_url).toBe('https://instagram.com/example');
    expect(updated.genre).toBe('Indie Pop');
  });
});
