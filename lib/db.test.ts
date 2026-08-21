import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

// DATA_DIR must be set before lib/data-dir.ts (and therefore lib/db.ts) is
// ever imported, so this test runs against an isolated, throwaway SQLite
// file instead of the real dev/prod database.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-test-'));

const { createArtist, createUser, executeTrade, getNextArtist, getUserById } = await import('./db');

const STARTING_BALANCE_CENTS = 1_000_000; // $10,000

function makeUser(email: string) {
  return createUser({ name: 'Test Trader', email, password_hash: 'not-a-real-hash' });
}

function makeArtist(name: string) {
  // All eight score categories at 8/10 -> breakoutScore = 8 * (sum of
  // weights)/10 = 8 * 100/10 = 80 exactly. Deterministic, no seeding needed.
  return createArtist({
    name,
    music_talent: 8,
    growth_velocity: 8,
    engagement_quality: 8,
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
