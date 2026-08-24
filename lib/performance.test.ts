import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

// Own DATA_DIR + a genuinely large, controlled dataset (100+ artists, 30
// traders, hundreds of trades) — the shared lib/db.test.ts suite couldn't
// give us a clean before/after for timing without every other test file's
// own writes polluting the numbers. This is Phase 10's "performance testing
// with 100+ artists" / "trading testing with many users" checklist item:
// a real, repeatable measurement (and a regression guard — this fails
// loudly if a future change makes one of these read paths quadratic)
// rather than a one-off manual check that leaves no trace.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-test-'));

const {
  createArtist, createUser, executeTrade, getDiscoveryLeaderboard, getNextMarket, getScoutLeaderboard,
  getSuspiciousTradingFlags,
} = await import('./db');

const ARTIST_COUNT = 120;
const TRADER_COUNT = 30;
const TRADES_PER_TRADER = 8;

// A generous budget for CI/sandboxed hardware, not a tight production SLA —
// the point is catching a genuine regression (an accidentally-quadratic
// query, an N+1), not chasing a specific millisecond target on a shared
// runner whose speed varies run to run.
const BUDGET_MS = 2000;

function seedArtists(count: number) {
  const genres = ['Pop', 'Hip-Hop', 'R&B', 'Country', 'Rock', 'Electronic'];
  const artists = [];
  for (let i = 0; i < count; i++) {
    artists.push(
      createArtist({
        name: `Perf Artist ${i}`,
        genre: genres[i % genres.length],
        music_talent: 5 + (i % 5),
        growth_velocity_pct: 10 + (i % 40),
        engagement_rate_pct: 5 + (i % 15),
        original_song_response: 5 + (i % 5),
        brand_personality: 5 + (i % 5),
        content_consistency: 5 + (i % 5),
        commercial_potential: 5 + (i % 5),
        professionalism: 5 + (i % 5),
      })
    );
  }
  return artists;
}

function seedTraders(count: number) {
  const traders = [];
  for (let i = 0; i < count; i++) {
    traders.push(createUser({ name: `Perf Trader ${i}`, email: `perf-trader-${i}@example.com`, password_hash: 'hash' }));
  }
  return traders;
}

function timeIt<T>(fn: () => T): { result: T; ms: number } {
  const start = performance.now();
  const result = fn();
  const ms = performance.now() - start;
  return { result, ms };
}

describe('Performance at scale (Phase 10) — 100+ artists, many traders and trades', () => {
  it(`seeds ${ARTIST_COUNT} artists, ${TRADER_COUNT} traders, and executes real trades across them within budget`, () => {
    const { result: artists, ms: seedArtistsMs } = timeIt(() => seedArtists(ARTIST_COUNT));
    expect(artists).toHaveLength(ARTIST_COUNT);
    console.log(`[perf] seeded ${ARTIST_COUNT} artists in ${seedArtistsMs.toFixed(0)}ms`);

    const { result: traders, ms: seedTradersMs } = timeIt(() => seedTraders(TRADER_COUNT));
    expect(traders).toHaveLength(TRADER_COUNT);
    console.log(`[perf] seeded ${TRADER_COUNT} traders in ${seedTradersMs.toFixed(0)}ms`);

    const { ms: tradesMs } = timeIt(() => {
      for (const trader of traders) {
        for (let t = 0; t < TRADES_PER_TRADER; t++) {
          const artist = artists[(trader.id + t) % artists.length];
          const buy = executeTrade(trader.id, artist.id, 'buy', 5_000 + t * 1_000);
          if (!buy.ok) throw new Error(buy.error);
        }
      }
    });
    const totalTrades = TRADER_COUNT * TRADES_PER_TRADER;
    console.log(`[perf] executed ${totalTrades} trades in ${tradesMs.toFixed(0)}ms (${(tradesMs / totalTrades).toFixed(2)}ms/trade)`);
    expect(tradesMs).toBeLessThan(BUDGET_MS * 5); // trading is the heaviest write path — a wider budget

    const { result: market, ms: marketMs } = timeIt(() => getNextMarket());
    console.log(`[perf] getNextMarket() over ${market.length} artists in ${marketMs.toFixed(0)}ms`);
    expect(market.length).toBeGreaterThanOrEqual(ARTIST_COUNT);
    expect(marketMs).toBeLessThan(BUDGET_MS);

    const { result: leaderboard, ms: leaderboardMs } = timeIt(() => getScoutLeaderboard());
    console.log(`[perf] getScoutLeaderboard() over ${leaderboard.length} scouts in ${leaderboardMs.toFixed(0)}ms`);
    expect(leaderboardMs).toBeLessThan(BUDGET_MS);

    const { ms: discoveryLeaderboardMs } = timeIt(() => getDiscoveryLeaderboard());
    console.log(`[perf] getDiscoveryLeaderboard() in ${discoveryLeaderboardMs.toFixed(0)}ms`);
    expect(discoveryLeaderboardMs).toBeLessThan(BUDGET_MS);

    // The heaviest read in the app by construction — pulls every
    // transaction and does O(n log n) grouping/sorting in JS (see
    // lib/market-integrity.ts). This is the one most worth a scale check.
    const { result: flags, ms: flagsMs } = timeIt(() => getSuspiciousTradingFlags());
    console.log(`[perf] getSuspiciousTradingFlags() over ${totalTrades} transactions in ${flagsMs.toFixed(0)}ms, ${flags.length} flags`);
    expect(flagsMs).toBeLessThan(BUDGET_MS);
  }, 30_000);
});
