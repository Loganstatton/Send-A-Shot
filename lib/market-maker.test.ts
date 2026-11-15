import { afterEach, describe, expect, it } from 'vitest';

// Phase 1: the NEXT market maker. These tests pin down what was asked for before production:
//   • the market maker can always honour every valid sale (heavy random trading, then everyone exits);
//   • the Credit ledger and reserves reconcile, and tampering is caught and halts trading;
//   • fees are exact and transparent; splitting and price impact behave; depth changes are safe;
//   • coordinated multi-account manipulation can't create Credits and is flagged;
//   • trading limits, deletions and concurrency keep the books balanced.

const {
  createArtist, createUser, deleteArtist, deleteUser, executeTrade, executeTradeRequest, getArtist, getHolding,
  getPumpPatternReport, getUserById, getUserHoldings, markEmailVerified, db,
} = await import('./db');
const {
  applyDepthChange, getFeePoolCents, previewDepthChange, reconcileMarket, resumeArtistTrading,
} = await import('./market-ledger');
const nm = await import('./next-market');
const { findPumpPatterns } = await import('./market-integrity');

const START = nm.NEXT_STARTING_CREDITS_CENTS;
const SELL_ALL = nm.SELL_ALL_SENTINEL_CENTS;
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

let seq = 0;
async function makeUser(label = 'Trader') {
  seq++;
  return createUser({ name: `${label} ${seq}`, email: `mm-${label.toLowerCase().replace(/\W/g, '')}-${seq}@example.com`, password_hash: 'hash' });
}
async function makeArtist(label = 'Artist') {
  seq++;
  return createArtist({
    name: `${label} ${seq}`, genre: 'Pop', music_talent: 6, growth_velocity: 6, engagement_quality: 6, original_song_response: 6,
    brand_personality: 6, content_consistency: 6, commercial_potential: 6, professionalism: 6,
  });
}
const credits = async (id: number) => (await getUserById(id))!.next_credits_cents;
async function ok<T extends { ok: boolean }>(p: Promise<T>): Promise<Extract<T, { ok: true }>> { const r = await p; if (!r.ok) throw new Error(`trade failed: ${(r as any).error}`); return r as Extract<T, { ok: true }>; }
async function expectBooksBalance() {
  const report = await reconcileMarket();
  expect(report.issues, JSON.stringify(report.issues.slice(0, 5))).toEqual([]);
  expect(report.ok).toBe(true);
  return report;
}
async function curve(artistId: number) {
  const a = (await getArtist(artistId))!;
  return { price: Number(a.next_current_price_cents), anchor: Number(a.next_anchor_price_cents), depth: Number(a.next_depth_cents),
    q: Number(a.next_shares_outstanding), reserve: Number(a.next_reserve_cents), halted: a.next_trading_halted_at };
}

afterEach(() => { process.env.NEXT_NEW_ACCOUNT_DAYS = '0'; delete process.env.NEXT_REQUIRE_VERIFIED_EMAIL; });

describe('the market maker always honours valid sales', () => {
  it('600 random trades by 15 accounts, books balanced throughout; then everyone exits in random order and is paid in full', async () => {
    const artist = await makeArtist('Honour');
    const users = await Promise.all(Array.from({ length: 15 }, () => makeUser('Honour')));
    const r = rng(20261116);
    for (let i = 0; i < 600; i++) {
      const u = users[Math.floor(r() * users.length)];
      const h = await getHolding(u.id, artist.id);
      if (r() < 0.55 || !h) {
        const bal = await credits(u.id);
        const amt = Math.min(bal, 100 + Math.floor(r() ** 3 * 300_000));
        if (amt >= 100) await ok(executeTrade(u.id, artist.id, 'buy', amt));
      } else {
        const value = nm.exitValueCents((await curve(artist.id)).price, h.shares, (await curve(artist.id)).depth);
        const amt = r() < 0.3 ? SELL_ALL : Math.max(1, Math.floor(value * r()));
        const res = await executeTrade(u.id, artist.id, 'sell', amt);
        if (!res.ok) expect(res.error).toBe('amount is too small to sell');
      }
      if (i % 150 === 149) await expectBooksBalance();
    }
    // Everyone sells out, in a random order, each in 1–4 pieces. Every sale must be paid.
    const order = [...users].sort(() => r() - 0.5);
    for (const u of order) {
      for (let piece = 0; piece < 4; piece++) {
        const h = await getHolding(u.id, artist.id); if (!h) break;
        const last = piece === 3 || r() < 0.35;
        const value = nm.exitValueCents((await curve(artist.id)).price, h.shares, (await curve(artist.id)).depth);
        await ok(executeTrade(u.id, artist.id, 'sell', last ? SELL_ALL : Math.max(100, Math.floor(value / 2))));
      }
      expect(await getHolding(u.id, artist.id)).toBeUndefined();
    }
    const c = await curve(artist.id);
    expect(c.q).toBeCloseTo(0, 12);                                   // every share is back with the market maker
    expect(c.price / c.anchor).toBeCloseTo(1, 9);                     // and the price is back where it started
    expect(c.reserve).toBeGreaterThanOrEqual(0);                      // never paid out more than it held
    // Credits are conserved exactly: players + reserve + fees = what they started with
    const balances = await Promise.all(users.map((u) => credits(u.id)));
    const fees = Number(((await db.prepare('SELECT COALESCE(SUM(fee_cents),0) AS f FROM next_transactions WHERE artist_id = ?').get(artist.id)) as { f: number }).f);
    expect(balances.reduce((s, b) => s + b, 0) + fees + c.reserve).toBe(users.length * START);
    await expectBooksBalance();
  });

  it('simultaneous buys and sells by 12 accounts on one artist keep the books balanced', async () => {
    const artist = await makeArtist('Simul');
    const users = await Promise.all(Array.from({ length: 12 }, () => makeUser('Simul')));
    await Promise.all(users.map((u, i) => executeTrade(u.id, artist.id, 'buy', 40_000 + i * 9_973)));
    await Promise.all(users.flatMap((u, i) => [
      executeTrade(u.id, artist.id, 'sell', 5_000 + i * 101), executeTrade(u.id, artist.id, 'buy', 3_000 + i * 77),
      executeTrade(u.id, artist.id, i % 3 === 0 ? 'sell' : 'buy', i % 3 === 0 ? SELL_ALL : 1_000),
    ]));
    await expectBooksBalance();
    await Promise.all(users.map((u) => executeTrade(u.id, artist.id, 'sell', SELL_ALL)));
    const c = await curve(artist.id);
    expect(c.q).toBeCloseTo(0, 12); expect(c.reserve).toBeGreaterThanOrEqual(0);
    await expectBooksBalance();
  });

  it('a sale can never take more than the reserve or the shares the curve holds', async () => {
    const artist = await makeArtist('Guard');
    const u = await makeUser('Guard');
    await ok(executeTrade(u.id, artist.id, 'buy', 50_000));
    // tamper: pretend the reserve is short; the sale is refused, nothing changes, and trading halts
    await db.prepare('UPDATE artists SET next_reserve_cents = next_reserve_cents - 10000 WHERE id = ?').run(artist.id);
    const before = await credits(u.id);
    const res = await executeTrade(u.id, artist.id, 'sell', SELL_ALL);
    expect(res.ok).toBe(false);
    expect(await credits(u.id)).toBe(before);
    expect((await curve(artist.id)).halted).toBeTruthy();
    // restore the reserve; an admin resumes; the sale goes through
    await db.prepare('UPDATE artists SET next_reserve_cents = next_reserve_cents + 10000 WHERE id = ?').run(artist.id);
    await resumeArtistTrading(artist.id);
    await ok(executeTrade(u.id, artist.id, 'sell', SELL_ALL));
    await expectBooksBalance();
  });
});

describe('ledger and reconciliation', () => {
  it('every signup, trade and fee is a balanced ledger entry, and the totals conserve Credits', async () => {
    const report = await expectBooksBalance();
    const t = report.totals;
    expect(t.playersCents + t.reservesCents + t.feePoolCents + t.retiredCents).toBe(t.issuedCents + t.openingReserveCents + t.liquidityAddedCents);
    const unbalanced = await db.prepare('SELECT entry_id FROM next_ledger GROUP BY entry_id HAVING SUM(amount_cents) <> 0').all();
    expect(unbalanced).toEqual([]);
    const u = await makeUser('Ledger');
    const rows = (await db.prepare("SELECT account, amount_cents FROM next_ledger WHERE kind = 'signup_grant' AND user_id = ?").all(u.id)) as { account: string; amount_cents: number }[];
    expect(rows.map((x) => [x.account, Number(x.amount_cents)]).sort()).toEqual([['issuance', -START], [`user:${u.id}`, START]].sort());
  });

  it('reconciliation catches a tampered balance, reserve or holding, and halts the affected artist', async () => {
    const artist = await makeArtist('Tamper');
    const u = await makeUser('Tamper');
    await ok(executeTrade(u.id, artist.id, 'buy', 20_000));
    await expectBooksBalance();

    await db.prepare('UPDATE users SET next_credits_cents = next_credits_cents + 1 WHERE id = ?').run(u.id);
    let r = await reconcileMarket();
    expect(r.issues.map((i) => i.check)).toEqual(expect.arrayContaining(['player_balance_matches_ledger', 'credits_conserved']));
    await db.prepare('UPDATE users SET next_credits_cents = next_credits_cents - 1 WHERE id = ?').run(u.id);

    await db.prepare('UPDATE next_holdings SET shares = shares + 1 WHERE user_id = ? AND artist_id = ?').run(u.id, artist.id);
    r = await reconcileMarket({ haltOnFailure: true });
    expect(r.issues.find((i) => i.check === 'shares_held_match_curve')?.artistId).toBe(artist.id);
    expect(r.haltedArtistIds).toContain(artist.id);
    expect((await executeTrade(u.id, artist.id, 'buy', 1_000)).ok).toBe(false);          // halted: no trading
    await db.prepare('UPDATE next_holdings SET shares = shares - 1 WHERE user_id = ? AND artist_id = ?').run(u.id, artist.id);

    await db.prepare('UPDATE artists SET next_reserve_cents = next_reserve_cents + 5 WHERE id = ?').run(artist.id);
    r = await reconcileMarket();
    expect(r.issues.map((i) => i.check)).toContain('reserve_matches_ledger');
    await db.prepare('UPDATE artists SET next_reserve_cents = next_reserve_cents - 5 WHERE id = ?').run(artist.id);

    await resumeArtistTrading(artist.id);
    await ok(executeTrade(u.id, artist.id, 'buy', 1_000));
    await expectBooksBalance();
  });

  it('deleting an account or an artist moves its Credits to "retired" and keeps every other holder whole', async () => {
    const artist = await makeArtist('Retire');
    const [stay, leave] = [await makeUser('Stay'), await makeUser('Leave')];
    await ok(executeTrade(stay.id, artist.id, 'buy', 30_000));
    await ok(executeTrade(leave.id, artist.id, 'buy', 60_000));
    const priceBefore = (await curve(artist.id)).price;
    const stayValue = (await getUserHoldings(stay.id)).find((h) => h.artist_id === artist.id)!.exitValueCents;
    await deleteUser(leave.id);
    expect((await curve(artist.id)).price).toBe(priceBefore);                       // nobody else's price moves
    expect((await getUserHoldings(stay.id)).find((h) => h.artist_id === artist.id)!.exitValueCents).toBe(stayValue);
    await expectBooksBalance();
    await ok(executeTrade(stay.id, artist.id, 'sell', SELL_ALL));                    // and they can still exit in full
    expect((await curve(artist.id)).reserve).toBeGreaterThanOrEqual(0);
    await expectBooksBalance();

    const gone = await makeArtist('Gone');
    await ok(executeTrade(stay.id, gone.id, 'buy', 10_000));
    await deleteArtist(gone.id);
    await expectBooksBalance();
  });
});

describe('fees, splitting and price impact', () => {
  it('purchases pay exactly 0.5% (rounded up to the cent) into the fee pool; sales pay nothing', async () => {
    const artist = await makeArtist('Fee');
    const u = await makeUser('Fee');
    const pool0 = await getFeePoolCents();
    const buy = await ok(executeTrade(u.id, artist.id, 'buy', 12_345));
    expect(buy.feeCents).toBe(Math.ceil(12_345 * 0.005));                           // 62
    expect(await credits(u.id)).toBe(START - 12_345);
    const tx = (await db.prepare("SELECT fee_cents FROM next_transactions WHERE user_id = ? AND type = 'buy'").get(u.id)) as { fee_cents: number };
    expect(Number(tx.fee_cents)).toBe(62);
    expect((await curve(artist.id)).reserve).toBe(12_345 - 62);                     // only the net reaches the market maker
    const sell = await ok(executeTrade(u.id, artist.id, 'sell', SELL_ALL));
    expect(sell.feeCents).toBe(0);
    expect(await getFeePoolCents()).toBe(pool0 + 62);
    expect(nm.buyFeeCents(100_000)).toBe(500); expect(nm.buyFeeCents(1)).toBe(1); expect(nm.buyFeeCents(0)).toBe(0);
  });

  it('a round trip always returns less than was paid (the fee and rounding), never more', () => {
    for (const p of [100, 1_000, 2_203, 9_999]) for (const amt of [100, 1_000, 99_999, 1_000_000]) for (const depth of [nm.DEFAULT_DEPTH_CENTS, 25_000_000, 80_000_000]) {
      const b = nm.quoteBuyWithFee(p, amt, depth);
      const s = nm.quoteSell(b.postPriceCents, b.shares, depth);
      expect(s.proceedsCents).toBeLessThanOrEqual(amt - b.feeCents);
      expect(s.postPriceCents / p).toBeCloseTo(1, 9);
    }
  });

  it('splitting a purchase or a sale never beats doing it at once, at any depth (3,000 random strategies)', () => {
    const r = rng(42);
    for (let t = 0; t < 3_000; t++) {
      const p = 100 + Math.floor(r() * 9_000), depth = nm.DEFAULT_DEPTH_CENTS * (1 + r() * 3), total = 1_000 + Math.floor(r() * 1_000_000);
      const pieces = 1 + Math.floor(r() * 40);
      const once = nm.quoteBuyWithFee(p, total, depth);
      let price = p, shares = 0, spent = 0;
      for (let i = 0; i < pieces; i++) {
        const c = i === pieces - 1 ? total - spent : Math.min(total - spent, Math.max(100, Math.floor(total / pieces))); if (c <= 0) break;
        const q = nm.quoteBuyWithFee(price, c, depth); shares += q.shares; price = q.postPriceCents; spent += c;
      }
      expect(shares).toBeLessThanOrEqual(once.shares + 1e-9);
      // selling in pieces pays no more than selling at once
      const whole = nm.quoteSell(price, shares, depth).proceedsCents;
      let sp = price, left = shares, got = 0;
      for (let i = 0; i < pieces && left > 0; i++) { const s = i === pieces - 1 ? left : left / (pieces - i); const q = nm.quoteSell(sp, s, depth); got += q.proceedsCents; sp = q.postPriceCents; left -= s; }
      expect(got).toBeLessThanOrEqual(whole);
      expect(got + 0).toBeLessThanOrEqual(spent);                                     // and the whole thing never profits
    }
  });

  it('price impact is exactly e^(Credits into the curve ÷ depth) and shrinks as depth grows', () => {
    for (const depth of [nm.DEFAULT_DEPTH_CENTS, 50_000_000]) {
      const q = nm.quoteBuy(1_000, 1_000_000, depth);
      expect(q.postPriceCents / 1_000).toBeCloseTo(Math.exp(1_000_000 / depth), 6);
    }
    expect(nm.priceImpactPct(1_000_000, 50_000_000)).toBeLessThan(nm.priceImpactPct(1_000_000));
    expect(nm.priceImpactPct(1_000_000) * 100).toBeCloseTo(5.13, 2);                  // ~5% per 10,000 Credits
  });

  it('new artists list at 10 Credits a share; artists listed before Phase 1 keep their Score-based price', async () => {
    const fresh = await makeArtist('Fresh');
    const u = await makeUser('Lister');
    await ok(executeTrade(u.id, fresh.id, 'buy', 1_000));
    const first = (await db.prepare('SELECT price_cents FROM next_price_history WHERE artist_id = ? ORDER BY id LIMIT 1').get(fresh.id)) as { price_cents: number };
    expect(Number(first.price_cents)).toBe(nm.NEXT_LISTING_PRICE_CENTS);
    const legacy = await makeArtist('Legacy');
    await db.prepare("UPDATE artists SET next_listing_rule = 'score' WHERE id = ?").run(legacy.id);
    await ok(executeTrade(u.id, legacy.id, 'buy', 1_000));
    const lf = (await db.prepare('SELECT price_cents FROM next_price_history WHERE artist_id = ? ORDER BY id LIMIT 1').get(legacy.id)) as { price_cents: number };
    const { breakoutScore } = await import('./scoring');
    expect(Number(lf.price_cents)).toBe(nm.nextBasePriceCents(breakoutScore((await getArtist(legacy.id))!)));
  });
});

describe('depth changes (admin-approved)', () => {
  it('raise depth ×1.2: price and shares unchanged, every holder worth at least as much, reserve topped up (fee pool first), books balanced, everyone can still exit', async () => {
    const artist = await makeArtist('Deep');
    const holders = await Promise.all(Array.from({ length: 6 }, () => makeUser('Deep')));
    for (const [i, h] of holders.entries()) await ok(executeTrade(h.id, artist.id, 'buy', 100_000 * (i + 1)));
    const admin = await makeUser('Admin');
    const before = await curve(artist.id);
    const valuesBefore = await Promise.all(holders.map(async (h) => (await getUserHoldings(h.id)).find((x) => x.artist_id === artist.id)!.exitValueCents));
    const poolBefore = await getFeePoolCents();
    const liquidityBefore = Number(((await db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS s FROM next_ledger WHERE account = 'liquidity'").get()) as { s: number }).s);

    const target = Math.round(before.depth * 1.2);
    const preview = await previewDepthChange(artist.id, target);
    if ('error' in preview) throw new Error(preview.error);
    expect(preview.ok).toBe(true);
    const res = await applyDepthChange(artist.id, target, admin.id, 'test');
    if (!res.ok) throw new Error(res.error);
    const after = await curve(artist.id);

    expect(after.price).toBeCloseTo(before.price, 9);
    expect(after.q).toBe(before.q);
    expect(after.depth).toBe(target);
    const valuesAfter = await Promise.all(holders.map(async (h) => (await getUserHoldings(h.id)).find((x) => x.artist_id === artist.id)!.exitValueCents));
    valuesAfter.forEach((v, i) => expect(v).toBeGreaterThanOrEqual(valuesBefore[i]));
    const owedAfter = nm.owedCents(after.price, after.anchor, after.depth);
    expect(after.reserve).toBe(before.reserve + res.change.topUpCents);
    expect(after.reserve).toBeGreaterThanOrEqual(owedAfter);
    expect(res.change.topUpCents).toBe(Math.max(0, Math.ceil(owedAfter - before.reserve - 1e-9)));
    expect(res.change.fromFeePoolCents).toBe(Math.min(res.change.topUpCents, poolBefore));
    expect(await getFeePoolCents()).toBe(poolBefore - res.change.fromFeePoolCents);
    const liquidityAfter = Number(((await db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS s FROM next_ledger WHERE account = 'liquidity'").get()) as { s: number }).s);
    expect(liquidityBefore - liquidityAfter).toBe(res.change.fromLiquidityCents);
    const recorded = (await db.prepare('SELECT approved_by_user_id, top_up_cents FROM next_depth_changes WHERE artist_id = ?').get(artist.id)) as { approved_by_user_id: number; top_up_cents: number };
    expect(Number(recorded.approved_by_user_id)).toBe(admin.id);
    await expectBooksBalance();

    for (const h of holders) await ok(executeTrade(h.id, artist.id, 'sell', SELL_ALL));
    const end = await curve(artist.id);
    expect(end.q).toBeCloseTo(0, 12); expect(end.reserve).toBeGreaterThanOrEqual(0);
    await expectBooksBalance();
  });

  it('depth only ever rises, by at most ×1.25 in any 7 days', async () => {
    const artist = await makeArtist('Limits');
    const u = await makeUser('Limits'); const admin = await makeUser('Admin');
    await ok(executeTrade(u.id, artist.id, 'buy', 50_000));
    const d = (await curve(artist.id)).depth;
    expect((await applyDepthChange(artist.id, d - 1, admin.id)).ok).toBe(false);          // decrease
    expect((await applyDepthChange(artist.id, d, admin.id)).ok).toBe(false);              // no change
    expect((await applyDepthChange(artist.id, Math.round(d * 1.3), admin.id)).ok).toBe(false);
    expect((await applyDepthChange(artist.id, Math.round(d * 1.2), admin.id)).ok).toBe(true);
    expect((await applyDepthChange(artist.id, Math.round(d * 1.26), admin.id)).ok).toBe(false); // cumulative >1.25 this week
    expect((await applyDepthChange(artist.id, Math.round(d * 1.249), admin.id)).ok).toBe(true);
    // a week later the window restarts from the depth then
    await db.prepare("UPDATE next_depth_changes SET created_at = '2026-01-01T00:00:00.000Z' WHERE artist_id = ?").run(artist.id);
    expect((await applyDepthChange(artist.id, Math.round(d * 1.249 * 1.2), admin.id)).ok).toBe(true);
    await expectBooksBalance();
  });

  it('when the fee pool cannot cover a top-up, the rest is disclosed liquidity and Credits are still conserved', async () => {
    const artist = await makeArtist('Liquidity');
    const users = await Promise.all(Array.from({ length: 10 }, () => makeUser('Liq')));
    for (const u of users) await ok(executeTrade(u.id, artist.id, 'buy', START));      // 100,000 Credits held
    const admin = await makeUser('Admin');
    const preview = await previewDepthChange(artist.id, Math.round(nm.DEFAULT_DEPTH_CENTS * 1.25));
    if ('error' in preview) throw new Error(preview.error);
    const res = await applyDepthChange(artist.id, Math.round(nm.DEFAULT_DEPTH_CENTS * 1.25), admin.id);
    if (!res.ok) throw new Error(res.error);
    expect(res.change.topUpCents).toBeGreaterThan(0);
    expect(res.change.fromFeePoolCents + res.change.fromLiquidityCents).toBe(res.change.topUpCents);
    const report = await expectBooksBalance();
    expect(report.totals.liquidityAddedCents).toBeGreaterThanOrEqual(res.change.fromLiquidityCents);
    for (const u of users) await ok(executeTrade(u.id, artist.id, 'sell', SELL_ALL));
    expect((await curve(artist.id)).reserve).toBeGreaterThanOrEqual(0);
    await expectBooksBalance();
  });

  it('a depth change and trades at the same moment leave the books balanced', async () => {
    const artist = await makeArtist('Race');
    const users = await Promise.all(Array.from({ length: 8 }, () => makeUser('Race')));
    const admin = await makeUser('Admin');
    await Promise.all(users.map((u) => executeTrade(u.id, artist.id, 'buy', 80_000)));
    const d = (await curve(artist.id)).depth;
    await Promise.all([
      applyDepthChange(artist.id, Math.round(d * 1.1), admin.id),
      ...users.map((u, i) => executeTrade(u.id, artist.id, i % 2 ? 'sell' : 'buy', i % 2 ? 20_000 : 15_000)),
    ]);
    await expectBooksBalance();
  });
});

describe('trading limits', () => {
  it('a new, unverified account can buy at most 2,500 Credits of one artist a day; verifying lifts it; selling is never limited', async () => {
    process.env.NEXT_NEW_ACCOUNT_DAYS = '3';
    const artist = await makeArtist('NewAcct'); const other = await makeArtist('Other');
    const u = await makeUser('Newbie');
    await ok(executeTrade(u.id, artist.id, 'buy', 200_000));
    const over = await executeTrade(u.id, artist.id, 'buy', 60_000);
    expect(over.ok).toBe(false); if (!over.ok) expect(over.error).toMatch(/New accounts can buy up to 2,500 Credits/);
    await ok(executeTrade(u.id, artist.id, 'buy', 50_000));                         // exactly up to the limit
    await ok(executeTrade(u.id, other.id, 'buy', 250_000));                          // per artist
    await ok(executeTrade(u.id, artist.id, 'sell', SELL_ALL));                        // selling always works
    await markEmailVerified(u.id);
    await ok(executeTrade(u.id, artist.id, 'buy', 400_000));
    // an established account (older than 3 days) has no such limit
    const old = await makeUser('Veteran');
    await db.prepare("UPDATE users SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(old.id);
    await ok(executeTrade(old.id, artist.id, 'buy', 900_000));
    await expectBooksBalance();
  });

  it('smallest purchase is 1 Credit; a daily trade cap applies; with NEXT_REQUIRE_VERIFIED_EMAIL=1 buying needs a verified email', async () => {
    const artist = await makeArtist('Caps');
    const u = await makeUser('Caps');
    expect((await executeTrade(u.id, artist.id, 'buy', 99)).ok).toBe(false);
    await ok(executeTrade(u.id, artist.id, 'buy', 100));
    // daily cap: 500 trades in 24 h (the per-minute limit is checked first, so these are spread over the day)
    for (let i = 0; i < nm.DAILY_TRADE_LIMIT; i++) {
      await db.prepare("INSERT INTO next_transactions (user_id, artist_id, created_at, type, shares, price_cents_per_share, credits_delta_cents) VALUES (?, ?, ?, 'buy', 0, 0, 0)")
        .run(u.id, artist.id, new Date(Date.now() - (i + 2) * 120_000).toISOString());
    }
    const capped = await executeTradeRequest(u.id, artist.id, 'buy', 1_000);
    expect(capped.status).toBe(429);
    await db.prepare("DELETE FROM next_transactions WHERE user_id = ? AND credits_delta_cents = 0").run(u.id);
    process.env.NEXT_REQUIRE_VERIFIED_EMAIL = '1';
    const unverified = await executeTrade(u.id, artist.id, 'buy', 1_000);
    expect(unverified.ok).toBe(false);
    await ok(executeTrade(u.id, artist.id, 'sell', SELL_ALL));                         // selling is still allowed
    await markEmailVerified(u.id);
    await ok(executeTrade(u.id, artist.id, 'buy', 1_000));
    await expectBooksBalance();
  });

  it('an order is refused if the price moved more than 2% against the quote the player saw', async () => {
    const artist = await makeArtist('Quote');
    const [a, b] = [await makeUser('Quote'), await makeUser('Quote')];
    await ok(executeTrade(a.id, artist.id, 'buy', 1_000));
    const quoted = (await curve(artist.id)).price;
    await ok(executeTrade(b.id, artist.id, 'buy', 900_000));                          // someone moves it ~4.6%
    const stale = await executeTrade(a.id, artist.id, 'buy', 10_000, { quotedPriceCents: quoted });
    expect(stale.ok).toBe(false);
    await ok(executeTrade(a.id, artist.id, 'buy', 10_000, { quotedPriceCents: (await curve(artist.id)).price }));
    await ok(executeTrade(a.id, artist.id, 'sell', SELL_ALL, { quotedPriceCents: quoted }));   // a price ABOVE the quote is fine for a seller
  });
});

describe('coordinated multi-account manipulation', () => {
  it('a group of accounts cannot create Credits together, whatever they do (40 random group games)', async () => {
    const r = rng(777);
    for (let g = 0; g < 40; g++) {
      const artist = await makeArtist('Group');
      const group = await Promise.all(Array.from({ length: 5 }, () => makeUser('Group')));
      for (let i = 0; i < 25; i++) {
        const u = group[Math.floor(r() * group.length)];
        const h = await getHolding(u.id, artist.id);
        if (r() < 0.55 || !h) { const amt = Math.min(await credits(u.id), 100 + Math.floor(r() * 400_000)); if (amt >= 100) await executeTrade(u.id, artist.id, 'buy', amt); }
        else await executeTrade(u.id, artist.id, 'sell', r() < 0.4 ? SELL_ALL : 1 + Math.floor(r() * 200_000));
      }
      for (const u of group) await executeTrade(u.id, artist.id, 'sell', SELL_ALL);
      const total = (await Promise.all(group.map((u) => credits(u.id)))).reduce((s, c) => s + c, 0);
      expect(total).toBeLessThanOrEqual(group.length * START);
    }
    await expectBooksBalance();
  });

  it('pump and dump: throwaway accounts can only move Credits to one account at a loss, and the pattern is flagged', async () => {
    const artist = await makeArtist('Pump');
    const main = await makeUser('Main');
    await db.prepare("UPDATE users SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(main.id);
    const throwaways = await Promise.all(Array.from({ length: 5 }, () => makeUser('Throwaway')));
    await ok(executeTrade(main.id, artist.id, 'buy', START));
    for (const t of throwaways) await ok(executeTrade(t.id, artist.id, 'buy', START));
    await ok(executeTrade(main.id, artist.id, 'sell', SELL_ALL));
    const gain = (await credits(main.id)) - START;
    for (const t of throwaways) await ok(executeTrade(t.id, artist.id, 'sell', SELL_ALL));
    const lost = throwaways.length * START - (await Promise.all(throwaways.map((t) => credits(t.id)))).reduce((s, c) => s + c, 0);
    expect(gain).toBeGreaterThan(0);
    expect(gain).toBeLessThan(lost);                                                   // lossy: no Credits created
    const report = await getPumpPatternReport();
    const flag = report.patterns.find((p) => p.beneficiaryId === main.id && p.artistId === artist.id);
    expect(flag).toBeDefined();
    // The throwaways that sold out first can come out ahead; the feeders are exactly the ones left at a loss
    // (here 3 of 5), and the group as a whole still loses more than the main account gains.
    const losers = [];
    for (const t of throwaways) if ((await credits(t.id)) < START) losers.push(t.id);
    expect(losers.length).toBeGreaterThanOrEqual(2);
    expect(flag!.feeders.map((f) => f.userId).sort()).toEqual(losers.sort());
    await expectBooksBalance();
  });

  it('organic trading by established, diversified players is not flagged', async () => {
    const artist = await makeArtist('Organic'); const others = [await makeArtist('Elsewhere'), await makeArtist('Elsewhere')];
    const early = await makeUser('Early');
    const crowd = await Promise.all(Array.from({ length: 6 }, () => makeUser('Crowd')));
    for (const u of [early, ...crowd]) await db.prepare("UPDATE users SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(u.id);
    await ok(executeTrade(early.id, artist.id, 'buy', 300_000));
    for (const u of crowd) { await ok(executeTrade(u.id, others[0].id, 'buy', 200_000)); await ok(executeTrade(u.id, others[1].id, 'buy', 200_000)); await ok(executeTrade(u.id, artist.id, 'buy', 100_000)); }
    await ok(executeTrade(early.id, artist.id, 'sell', SELL_ALL));
    const report = await getPumpPatternReport();
    expect(report.patterns.find((p) => p.beneficiaryId === early.id && p.artistId === artist.id)).toBeUndefined();
  });

  it('the detector needs two or more thin feeders, and marks a repeated beneficiary', () => {
    const T = (id: number, user: number, artist: number, min: number, type: 'buy' | 'sell', cents: number) =>
      ({ id, user_id: user, artist_id: artist, created_at: new Date(Date.UTC(2026, 5, 1) + min * 60_000).toISOString(), type, shares: 1, credits_delta_cents: type === 'buy' ? -cents : cents });
    const accounts = new Map([[1, { id: 1, createdAt: '2026-01-01T00:00:00Z' }], ...[2, 3, 4].map((i) => [i, { id: i, createdAt: '2026-05-31T00:00:00Z' }] as const)]);
    const lossOf = () => 0;                                                            // feeders hold nothing worth anything
    // one feeder only: not flagged
    expect(findPumpPatterns([T(1, 1, 9, 0, 'buy', 100_000), T(2, 2, 9, 5, 'buy', 500_000), T(3, 1, 9, 10, 'sell', 150_000)], accounts, lossOf)).toEqual([]);
    // two feeders, twice: flagged, and the second time it's marked repeated
    const twice = [
      T(1, 1, 9, 0, 'buy', 100_000), T(2, 2, 9, 5, 'buy', 500_000), T(3, 3, 9, 6, 'buy', 500_000), T(4, 1, 9, 10, 'sell', 150_000),
      T(5, 1, 8, 100, 'buy', 100_000), T(6, 2, 8, 105, 'buy', 400_000), T(7, 4, 8, 106, 'buy', 400_000), T(8, 1, 8, 110, 'sell', 140_000),
    ];
    const flags = findPumpPatterns(twice, accounts, lossOf);
    expect(flags).toHaveLength(2);
    expect(flags.every((f) => f.recurring)).toBe(true);
  });
});
