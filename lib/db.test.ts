import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

// DATA_DIR must be set before lib/data-dir.ts (and therefore lib/db.ts) is
// ever imported, so this test runs against an isolated, throwaway SQLite
// file instead of the real dev/prod database.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-test-'));

const {
  approveDiscoveryCandidate, completeDiscoveryRun, completeSyncRun, createArtist, createDiscoveryRun, createSyncRun,
  createUser, executeTrade, getArtist, getArtistsWithSoundchartsLink, getDiscoveryCandidates, getKnownDiscoveryUuids,
  getKnownDiscoveryYoutubeChannelIds, getLatestDiscoveryRun, getLatestSyncRun, getNewDiscoveryCandidateCount,
  getNextArtist, getTrackedSoundchartsUuids, getUserById, insertDiscoveryCandidate, setDiscoveryCandidateStatus,
  updateArtist,
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
    // Human judgment is still required for the qualitative categories...
    expect(artist!.music_talent).toBe(0);
    // ...but Growth Velocity is derived immediately from the real growth %
    // Discovery already found — never manually rated, and never 0 just
    // because nobody's looked at this artist yet.
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

  it('Approve on a YouTube candidate carries its genre onto the new artist and never requires a Soundcharts uuid', () => {
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
    expect(artist.genre).toBe('rock-alternative');
    expect(artist.soundcharts_uuid ?? null).toBeNull();
  });

  it('a completed YouTube run round-trips its rejection breakdown — this is what tells a Scout "why zero", not just "zero"', () => {
    const run = createDiscoveryRun('youtube');
    completeDiscoveryRun(run.id, {
      status: 'completed',
      searchedCount: 90,
      candidatesFound: 0,
      quotaUsed: 602,
      rejectionBreakdown: {
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
