import { describe, expect, it } from 'vitest';

// What these tests are for: on the old single-file database every query ran
// to completion before the next began, so two trades could never overlap.
// On Postgres, requests genuinely run at the same time. Every test here
// fires many operations at once (Promise.all over real pooled connections)
// and then checks that the ledger is exactly what running them one at a
// time would have produced.

const {
  createArtist, createUser, db, executeTrade, executeTradeRequest, getArtist, getHolding, getNextArtist, getUserById,
  TRADE_RATE_LIMIT_PER_MINUTE,
} = await import('./db');
const { applyTradeImpact, NEXT_STARTING_CREDITS_CENTS, nextBasePriceCents } = await import('./next-market');
const { breakoutScore } = await import('./scoring');

let seq = 0;
async function makeUser(label: string) {
  seq++;
  return createUser({ name: `${label} ${seq}`, email: `conc-${label.toLowerCase()}-${seq}@example.com`, password_hash: 'hash' });
}
async function makeArtist(label: string) {
  seq++;
  return createArtist({
    name: `${label} ${seq}`, genre: 'Pop', music_talent: 7, growth_velocity: 7, engagement_quality: 7, original_song_response: 7,
    brand_personality: 7, content_consistency: 7, commercial_potential: 7, professionalism: 7,
  });
}
async function transactionsFor(userId: number) {
  return (await db.prepare('SELECT * FROM next_transactions WHERE user_id = ? ORDER BY id ASC').all(userId)) as {
    type: 'buy' | 'sell'; artist_id: number; shares: number; credits_delta_cents: number; price_cents_per_share: number;
  }[];
}

describe('Concurrent trades — no double spend', () => {
  it('ten simultaneous buys that together exceed the balance: only what the balance covers succeeds, and it never goes negative', async () => {
    const user = await makeUser('Spender');
    const artists = await Promise.all(Array.from({ length: 10 }, () => makeArtist('Spend Target')));

    // $4,000 each against a $10,000 balance: exactly two can be afforded.
    const results = await Promise.all(artists.map((a) => executeTrade(user.id, a.id, 'buy', 400_000)));

    const succeeded = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    expect(succeeded).toHaveLength(2);
    expect(failed).toHaveLength(8);
    for (const f of failed) expect(f.ok === false && f.error).toBe('not enough NEXT Credits');

    const after = (await getUserById(user.id))!;
    expect(after.next_credits_cents).toBe(NEXT_STARTING_CREDITS_CENTS - 2 * 400_000);
    expect(await transactionsFor(user.id)).toHaveLength(2);
  });

  it('simultaneous buys of the SAME artist by one user accumulate into one holding with nothing lost', async () => {
    const user = await makeUser('Stacker');
    const artist = await makeArtist('Stack Target');

    const results = await Promise.all(Array.from({ length: 8 }, () => executeTrade(user.id, artist.id, 'buy', 50_000)));
    expect(results.every((r) => r.ok)).toBe(true);

    const holding = (await getHolding(user.id, artist.id))!;
    const txs = await transactionsFor(user.id);
    expect(txs).toHaveLength(8);
    expect(holding.cost_basis_cents).toBe(8 * 50_000);
    expect(holding.shares).toBeCloseTo(txs.reduce((sum, t) => sum + t.shares, 0), 6);
    expect((await getUserById(user.id))!.next_credits_cents).toBe(NEXT_STARTING_CREDITS_CENTS - 8 * 50_000);
  });

  it('two simultaneous "sell everything" requests cannot sell the same shares twice', async () => {
    const user = await makeUser('Double Seller');
    const artist = await makeArtist('Sell Target');
    expect((await executeTrade(user.id, artist.id, 'buy', 300_000)).ok).toBe(true);
    const balanceAfterBuy = (await getUserById(user.id))!.next_credits_cents;

    const results = await Promise.all([
      executeTrade(user.id, artist.id, 'sell', 999_999_999),
      executeTrade(user.id, artist.id, 'sell', 999_999_999),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const loser = results.find((r) => !r.ok)!;
    expect(loser.ok === false && loser.error).toBe("you don't own any shares of this artist");
    expect(await getHolding(user.id, artist.id)).toBeUndefined();

    const sells = (await transactionsFor(user.id)).filter((t) => t.type === 'sell');
    expect(sells).toHaveLength(1);
    expect((await getUserById(user.id))!.next_credits_cents).toBe(balanceAfterBuy + sells[0].credits_delta_cents);
  });
});

describe('Concurrent trades — one artist, many traders', () => {
  it('every trade moves the price from where the previous one left it (no price update is lost)', async () => {
    const artist = await makeArtist('Crowded');
    const traders = await Promise.all(Array.from({ length: 20 }, () => makeUser('Crowd')));
    const openingPrice = nextBasePriceCents(breakoutScore(artist));

    const results = await Promise.all(traders.map((t) => executeTrade(t.id, artist.id, 'buy', 100_000)));
    expect(results.every((r) => r.ok)).toBe(true);

    // 20 identical buys applied one after another from the opening price.
    let expected = openingPrice;
    for (let i = 0; i < 20; i++) expected = applyTradeImpact(expected, 100_000, 'buy');
    expect((await getArtist(artist.id))!.next_current_price_cents).toBe(expected);

    // Opening point + exactly one point per trade, strictly rising.
    const history = (await getNextArtist(artist.id))!.priceHistory.map((p) => p.price_cents);
    expect(history).toHaveLength(21);
    expect(history[0]).toBe(openingPrice);
    for (let i = 1; i < history.length; i++) expect(history[i]).toBeGreaterThan(history[i - 1]);
    expect(history[history.length - 1]).toBe(expected);
  });

  it('Founding Believer ranks are 1..N with no duplicates when N people back a new artist at once', async () => {
    const artist = await makeArtist('Fresh Find');
    const traders = await Promise.all(Array.from({ length: 12 }, () => makeUser('Believer')));

    await Promise.all(traders.map((t) => executeTrade(t.id, artist.id, 'buy', 20_000)));

    const ranks = ((await db.prepare('SELECT discovery_rank FROM next_founding_believers WHERE artist_id = ? ORDER BY discovery_rank ASC').all(artist.id)) as { discovery_rank: number }[])
      .map((r) => r.discovery_rank);
    expect(ranks).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it('a brand-new artist loaded by many requests at once gets exactly one opening price point', async () => {
    const artist = await makeArtist('Unpriced');
    expect(artist.next_current_price_cents).toBeNull();

    const rows = await Promise.all(Array.from({ length: 10 }, () => getNextArtist(artist.id)));
    const prices = new Set(rows.map((r) => r!.priceCents));
    expect(prices.size).toBe(1);

    const points = (await db.prepare('SELECT COUNT(*) AS c FROM next_price_history WHERE artist_id = ?').get(artist.id)) as { c: number };
    expect(points.c).toBe(1);
  });
});

describe('Concurrent trades — the books always balance', () => {
  it('a burst of mixed buys and sells across users and artists leaves every balance and holding equal to the sum of its transactions', async () => {
    const users = await Promise.all(Array.from({ length: 6 }, () => makeUser('Mixed')));
    const artists = await Promise.all(Array.from({ length: 4 }, () => makeArtist('Mixed Target')));

    // Round 1: everyone buys into everything, all at once.
    await Promise.all(users.flatMap((u) => artists.map((a) => executeTrade(u.id, a.id, 'buy', 60_000))));
    // Round 2: all at once — partial sells, full sells, and more buys.
    await Promise.all(users.flatMap((u, ui) => artists.map((a, ai) => {
      const pick = (ui + ai) % 3;
      if (pick === 0) return executeTrade(u.id, a.id, 'sell', 25_000);
      if (pick === 1) return executeTrade(u.id, a.id, 'sell', 999_999_999);
      return executeTrade(u.id, a.id, 'buy', 40_000);
    })));

    for (const u of users) {
      const txs = await transactionsFor(u.id);
      const balance = (await getUserById(u.id))!.next_credits_cents;
      expect(balance).toBe(NEXT_STARTING_CREDITS_CENTS + txs.reduce((sum, t) => sum + t.credits_delta_cents, 0));
      expect(balance).toBeGreaterThanOrEqual(0);

      for (const a of artists) {
        const net = txs.filter((t) => t.artist_id === a.id).reduce((sum, t) => sum + (t.type === 'buy' ? t.shares : -t.shares), 0);
        const holding = await getHolding(u.id, a.id);
        if (holding) {
          expect(holding.shares).toBeCloseTo(net, 6);
          expect(holding.shares).toBeGreaterThan(0);
          expect(holding.cost_basis_cents).toBeGreaterThanOrEqual(0);
        } else {
          expect(Math.abs(net)).toBeLessThan(0.0001);
        }
      }
    }

    // Each artist's current price is the last point of its own history.
    for (const a of artists) {
      const market = (await getNextArtist(a.id))!;
      expect(market.priceHistory[market.priceHistory.length - 1].price_cents).toBe(market.priceCents);
    }
  });
});

describe('Trade requests — duplicates and rate limit under concurrency', () => {
  it('the same request sent ten times at once executes exactly one trade and every copy gets the same answer', async () => {
    const user = await makeUser('Retry');
    const artist = await makeArtist('Retry Target');

    const outcomes = await Promise.all(
      Array.from({ length: 10 }, () => executeTradeRequest(user.id, artist.id, 'buy', 75_000, 'same-key-ten-times'))
    );

    expect(outcomes.filter((o) => !o.replayed)).toHaveLength(1);
    expect(outcomes.filter((o) => o.replayed)).toHaveLength(9);
    expect(new Set(outcomes.map((o) => JSON.stringify(o.body))).size).toBe(1);
    expect(outcomes.every((o) => o.status === 200)).toBe(true);

    expect(await transactionsFor(user.id)).toHaveLength(1);
    expect((await getUserById(user.id))!.next_credits_cents).toBe(NEXT_STARTING_CREDITS_CENTS - 75_000);
  });

  it('a rejected request is remembered too: its retry replays the rejection instead of trying again', async () => {
    const user = await makeUser('Broke');
    const artist = await makeArtist('Too Expensive');

    const first = await executeTradeRequest(user.id, artist.id, 'buy', NEXT_STARTING_CREDITS_CENTS + 1, 'rejected-key');
    expect(first.status).toBe(400);
    expect(first.replayed).toBe(false);

    const second = await executeTradeRequest(user.id, artist.id, 'buy', NEXT_STARTING_CREDITS_CENTS + 1, 'rejected-key');
    expect(second.replayed).toBe(true);
    expect(second.status).toBe(400);
    expect(second.body).toEqual(first.body);
  });

  it('different keys are different trades', async () => {
    const user = await makeUser('Two Keys');
    const artist = await makeArtist('Two Keys Target');
    const [a, b] = await Promise.all([
      executeTradeRequest(user.id, artist.id, 'buy', 10_000, 'key-a'),
      executeTradeRequest(user.id, artist.id, 'buy', 10_000, 'key-b'),
    ]);
    expect(a.replayed).toBe(false);
    expect(b.replayed).toBe(false);
    expect(await transactionsFor(user.id)).toHaveLength(2);
  });

  it('a burst far over the per-minute limit executes exactly the limit, not one more', async () => {
    const user = await makeUser('Burst');
    const artist = await makeArtist('Burst Target');

    const outcomes = await Promise.all(
      Array.from({ length: TRADE_RATE_LIMIT_PER_MINUTE + 15 }, (_, i) => executeTradeRequest(user.id, artist.id, 'buy', 1_000, `burst-${i}`))
    );

    expect(outcomes.filter((o) => o.status === 200)).toHaveLength(TRADE_RATE_LIMIT_PER_MINUTE);
    expect(outcomes.filter((o) => o.status === 429)).toHaveLength(15);
    expect(await transactionsFor(user.id)).toHaveLength(TRADE_RATE_LIMIT_PER_MINUTE);
  });

  it('a request for a user that no longer exists is refused without touching anything', async () => {
    const artist = await makeArtist('Orphan Target');
    const outcome = await executeTradeRequest(987_654_321, artist.id, 'buy', 10_000, 'ghost');
    expect(outcome.status).toBe(401);
  });
});

describe('Trade validation', () => {
  it('fractional cents are rounded to whole cents rather than stored as fractions', async () => {
    const user = await makeUser('Fraction');
    const artist = await makeArtist('Fraction Target');
    const result = await executeTrade(user.id, artist.id, 'buy', 12_345.6);
    expect(result.ok).toBe(true);
    expect((await getUserById(user.id))!.next_credits_cents).toBe(NEXT_STARTING_CREDITS_CENTS - 12_346);
  });

  it('rejects zero, negative, NaN and infinite amounts', async () => {
    const user = await makeUser('Invalid');
    const artist = await makeArtist('Invalid Target');
    for (const amount of [0, -100, Number.NaN, Number.POSITIVE_INFINITY, 0.2]) {
      const result = await executeTrade(user.id, artist.id, 'buy', amount);
      expect(result.ok).toBe(false);
    }
    expect(await transactionsFor(user.id)).toHaveLength(0);
  });

  it("an artist marked 'passed' can still be sold out of, but not bought into", async () => {
    const { updateArtist } = await import('./db');
    const holder = await makeUser('Holder');
    const latecomer = await makeUser('Latecomer');
    const artist = await makeArtist('Delisted');
    expect((await executeTrade(holder.id, artist.id, 'buy', 50_000)).ok).toBe(true);

    await updateArtist(artist.id, { name: artist.name, stage: 'passed' });

    const buy = await executeTrade(latecomer.id, artist.id, 'buy', 50_000);
    expect(buy.ok === false && buy.error).toBe('this artist is no longer listed on NEXT');
    const sell = await executeTrade(holder.id, artist.id, 'sell', 999_999_999);
    expect(sell.ok).toBe(true);
    expect(await getHolding(holder.id, artist.id)).toBeUndefined();
  });
});
