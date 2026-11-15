import { describe, expect, it } from 'vitest';
import zlib from 'node:zlib';
import pg from 'pg';

// Phase 1 migration: existing balances, holdings and history must come through exactly, every holding must
// be worth what it was worth before, every reserve must cover its holders, and every existing holder must be
// able to sell out for exactly the value they were shown. Also: restoring a pre-Phase-1 backup.

const { createUser, executeTrade, getArtist, getUserById, getUserHoldings, createArtist, db } = await import('./db');
const { reconcileMarket, verifyMarketMigration } = await import('./market-ledger');
const { restoreBackup, runBackup } = await import('./db-backup');
const nm = await import('./next-market');
const { MARKET_ACCOUNTING_INIT_SQL, MIGRATIONS } = await import('./db-schema');

const SELL_ALL = nm.SELL_ALL_SENTINEL_CENTS;

describe('migration 016 on real pre-Phase-1 data (001 → 015, then 016)', () => {
  it('runs on a database at migration 015 and changes no balance, holding, price, transaction or history row', async () => {
    const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    const schema = `m016_${Date.now().toString(36)}`;
    try {
      await client.query(`CREATE SCHEMA "${schema}"; SET search_path = "${schema}"`);
      for (const m of MIGRATIONS.filter((x) => x.id < '016')) await client.query(m.sql);
      // Phase-0-shaped data: odd balances after trading, drifted prices, exact-decimal shares, an unpriced artist.
      await client.query(`INSERT INTO users (created_at, name, email, password_hash, next_credits_cents) VALUES
        ('2026-01-01', 'A', 'a@example.com', 'x', 1000000), ('2026-01-02', 'B', 'b@example.com', 'x', 548213),
        ('2026-01-03', 'C', 'c@example.com', 'x', 1243358), ('2026-01-04', 'D', 'd@example.com', 'x', 0)`);
      await client.query(`INSERT INTO artists (name, genre, next_current_price_cents, created_at, updated_at) VALUES
        ('P1', 'Pop', 2982.448135, '2026-01-01', '2026-01-01'), ('P2', 'Pop', 840, '2026-01-01', '2026-01-01'),
        ('P3', 'Pop', NULL, '2026-01-01', '2026-01-01'), ('P4', 'Pop', 100.000000001, '2026-01-01', '2026-01-01')`);
      const ids = (await client.query('SELECT id FROM artists ORDER BY id')).rows.map((r) => Number(r.id));
      const holdings: [number, number, string, number][] = [
        [1, ids[0], '201.974865350089770000', 450000], [2, ids[0], '0.333333333333333333', 1000], [3, ids[1], '1190.476190476190476190', 1000000],
        [4, ids[1], '4.5E-7', 1], [2, ids[3], '12.000000001', 1200],
      ];
      for (const [u, a, sh, cb] of holdings) {
        await client.query('INSERT INTO next_holdings (user_id, artist_id, shares, cost_basis_cents, updated_at) VALUES ($1, $2, $3::numeric, $4, $5)', [u, a, sh, cb, '2026-02-01']);
        await client.query("INSERT INTO next_transactions (user_id, artist_id, created_at, type, shares, price_cents_per_share, credits_delta_cents) VALUES ($1, $2, '2026-02-01', 'buy', $3::numeric, 2228, $4)", [u, a, sh, -cb]);
      }
      for (const a of ids) await client.query("INSERT INTO next_price_history (artist_id, recorded_at, price_cents) VALUES ($1, '2026-01-01', 1500)", [a]);
      const snap = async () => ({
        users: (await client.query('SELECT id, next_credits_cents::text AS c FROM users ORDER BY id')).rows,
        holdings: (await client.query('SELECT user_id, artist_id, shares::text AS s, cost_basis_cents::text AS cb FROM next_holdings ORDER BY id')).rows,
        prices: (await client.query('SELECT id, next_current_price_cents::text AS p FROM artists ORDER BY id')).rows,
        tx: (await client.query('SELECT id, shares::text AS s, credits_delta_cents::text AS c, price_cents_per_share::text AS pp FROM next_transactions ORDER BY id')).rows,
        history: (await client.query('SELECT id, price_cents::text AS p FROM next_price_history ORDER BY id')).rows,
      });
      const before = await snap();
      await client.query(MIGRATIONS.find((m) => m.id === '016_market_maker_ledger')!.sql);
      expect(await snap()).toEqual(before);                          // nothing anyone owned changed, to the last digit

      const artists = (await client.query('SELECT id, next_current_price_cents AS p, next_anchor_price_cents AS a, next_depth_cents AS d, next_shares_outstanding AS q, next_reserve_cents AS r, next_listing_rule AS rule FROM artists ORDER BY id')).rows;
      for (const a of artists) {
        expect(a.rule).toBe('score');                                // every existing artist keeps its Score-based listing
        if (a.p == null) { expect(Number(a.r)).toBe(0); continue; }
        const owed = nm.owedCents(Number(a.p), Number(a.a), Number(a.d));
        expect(Number(a.r)).toBeGreaterThanOrEqual(owed);            // every reserve covers its holders
        expect(Number(a.r) - owed).toBeLessThan(1);                  // by at most a cent of rounding
        expect(nm.curvePriceCents(Number(a.a), Number(a.q), Number(a.d)) / Number(a.p)).toBeCloseTo(1, 9);
      }
      const ledger = (await client.query('SELECT entry_id, SUM(amount_cents) AS s FROM next_ledger GROUP BY entry_id HAVING SUM(amount_cents) <> 0')).rows;
      expect(ledger).toEqual([]);
      const opening = (await client.query("SELECT user_id, amount_cents FROM next_ledger WHERE kind = 'opening_balance' AND account LIKE 'user:%' ORDER BY user_id")).rows;
      expect(opening.map((r) => String(r.amount_cents))).toEqual(before.users.map((u) => u.c));
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.end();
    }
  });
});

describe('market accounting set-up on legacy balances and holdings (the data step of 016)', () => {
  it('proves preservation, funds every reserve, reconciles, and every holder can then sell for exactly the value shown before', async () => {
    // Legacy state as Phase 0 left it: users inserted without ledger entries, prices that drifted under the old
    // rounding, holdings that sit on no curve, artists with no price yet.
    const users: number[] = [];
    for (const [i, bal] of [1_000_000, 734_219, 0, 1_587_002, 999_999].entries()) {
      const r = await db.prepare("INSERT INTO users (created_at, name, email, password_hash, next_credits_cents) VALUES ('2026-01-01', ?, ?, 'x', ?)")
        .run(`Legacy ${i}`, `legacy-${i}@example.com`, bal);
      users.push(r.lastInsertRowid as number);
    }
    const mk = async (name: string) => createArtist({ name, genre: 'Pop', music_talent: 7, growth_velocity: 7, engagement_quality: 7, original_song_response: 7, brand_personality: 7, content_consistency: 7, commercial_potential: 7, professionalism: 7 });
    const [a1, a2, a3] = [await mk('Legacy One'), await mk('Legacy Two'), await mk('Legacy Unpriced')];
    await db.prepare('UPDATE artists SET next_current_price_cents = ? WHERE id = ?').run(2982.448135, a1.id);
    await db.prepare('UPDATE artists SET next_current_price_cents = ? WHERE id = ?').run(840, a2.id);
    const hold = async (u: number, a: number, shares: string, cb: number) => {
      await db.prepare('INSERT INTO next_holdings (user_id, artist_id, shares, cost_basis_cents, updated_at) VALUES (?, ?, ?, ?, ?)').run(u, a, shares, cb, '2026-02-01');
      await db.prepare("INSERT INTO next_transactions (user_id, artist_id, created_at, type, shares, price_cents_per_share, credits_delta_cents) VALUES (?, ?, '2026-02-01', 'buy', ?, 2228, ?)").run(u, a, shares, -cb);
    };
    await hold(users[0], a1.id, '201.97486535008977', 450_000);
    await hold(users[1], a1.id, '0.333333333333333333', 1_000);
    await hold(users[2], a2.id, '1190.47619047619', 1_000_000);
    await hold(users[3], a2.id, '4.5e-7', 1);
    await hold(users[3], a1.id, '73.1', 220_000);
    await db.prepare("DELETE FROM next_ledger").run();
    await db.prepare("UPDATE artists SET next_listing_rule = 'uniform', next_anchor_price_cents = NULL, next_shares_outstanding = 0, next_reserve_cents = 0").run();

    const balancesBefore = await Promise.all(users.map(async (u) => (await getUserById(u))!.next_credits_cents));
    const valueBefore = new Map<string, number>();
    for (const u of users) for (const h of await db.prepare('SELECT h.artist_id, h.shares, a.next_current_price_cents AS p FROM next_holdings h JOIN artists a ON a.id = h.artist_id WHERE h.user_id = ?').all(u) as { artist_id: number; shares: number; p: number }[]) {
      valueBefore.set(`${u}:${h.artist_id}`, nm.phase0ExitValueCents(h.p, h.shares));
    }
    const pricesBefore = [Number((await getArtist(a1.id))!.next_current_price_cents), Number((await getArtist(a2.id))!.next_current_price_cents)];

    await db.exec(MARKET_ACCOUNTING_INIT_SQL);

    const v = await verifyMarketMigration();
    expect(v.ok).toBe(true);
    expect(v.balances.ledgerOpenedWithSameBalances).toBe(true);
    expect(v.holdings.count).toBe(5);
    expect(v.holdings.holdingsWhoseValueChanged).toBe(0);
    expect(v.holdings.valueAfterCents).toBe(v.holdings.valueBeforeCents);
    expect(v.reserves.everyReserveCovered).toBe(true);
    const report = await reconcileMarket();
    expect(report.issues).toEqual([]);
    expect([Number((await getArtist(a1.id))!.next_current_price_cents), Number((await getArtist(a2.id))!.next_current_price_cents)]).toEqual(pricesBefore);
    expect(await Promise.all(users.map(async (u) => (await getUserById(u))!.next_credits_cents))).toEqual(balancesBefore);
    expect((await getArtist(a3.id))!.next_listing_rule).toBe('score');      // existing artists keep their listing rule

    // The portfolio shows the same values as before, and selling pays exactly that.
    for (const u of users) {
      for (const h of await getUserHoldings(u)) expect(h.exitValueCents).toBe(valueBefore.get(`${u}:${h.artist_id}`));
    }
    for (const u of users) {
      for (const h of await getUserHoldings(u)) {
        const bal = (await getUserById(u))!.next_credits_cents;
        const sale = await executeTrade(u, h.artist_id, 'sell', SELL_ALL);
        if (!sale.ok) throw new Error(sale.error);
        // Selling one holding after another moves the price for the next, so compare the first exit exactly,
        // and every exit against the curve's own quote at that moment.
        expect((await getUserById(u))!.next_credits_cents - bal).toBe(h.exitValueCents);
      }
    }
    for (const a of [a1, a2]) {
      const after = (await getArtist(a.id))!;
      expect(Number(after.next_shares_outstanding)).toBeCloseTo(0, 12);
      expect(Number(after.next_reserve_cents)).toBeGreaterThanOrEqual(0);
    }
    expect((await reconcileMarket()).issues).toEqual([]);

    // New activity after migration keeps working: a new player, the uniform listing for a new artist.
    const fresh = await createUser({ name: 'After', email: 'after@example.com', password_hash: 'x' });
    const newArtist = await mk('Listed After');
    const buy = await executeTrade(fresh.id, newArtist.id, 'buy', 100_000);
    if (!buy.ok) throw new Error(buy.error);
    expect(Number((await db.prepare('SELECT price_cents FROM next_price_history WHERE artist_id = ? ORDER BY id LIMIT 1').get(newArtist.id) as { price_cents: number }).price_cents)).toBe(nm.NEXT_LISTING_PRICE_CENTS);
    expect((await reconcileMarket()).issues).toEqual([]);
  });

  it('restoring a backup taken before Phase 1 sets the books up again, with every balance and holding intact', async () => {
    const backup = await runBackup('manual' as any);
    const data = (await db.prepare('SELECT data FROM db_snapshots WHERE file_name = ?').get(backup.fileName)) as { data: Buffer };
    const snapshot = JSON.parse(zlib.gunzipSync(data.data).toString('utf8'));
    // Make it look like a pre-Phase-1 snapshot: no 016, no ledger or market-maker tables, no curve columns.
    snapshot.migrations = snapshot.migrations.filter((m: string) => m < '016');
    for (const t of ['next_ledger', 'next_market_migration_snapshot', 'next_depth_changes', 'next_reconciliation_runs']) delete snapshot.tables[t];
    for (const a of snapshot.tables.artists) for (const k of Object.keys(a)) if (/^next_(depth|anchor|shares_outstanding|retired|reserve|listing|trading_halt)/.test(k)) delete a[k];
    for (const t of snapshot.tables.next_transactions) delete t.fee_cents;
    const old = zlib.gzipSync(Buffer.from(JSON.stringify(snapshot)));
    await db.prepare('INSERT INTO db_snapshots (created_at, file_name, kind, size_bytes, row_count, data) VALUES (?, ?, ?, ?, ?, ?)')
      .run(new Date().toISOString(), 'pre-phase-1.json.gz', 'manual', old.length, 0, old);
    const balancesBefore = (await db.prepare('SELECT id, next_credits_cents FROM users ORDER BY id').all()) as unknown[];
    const holdingsBefore = (await db.prepare('SELECT user_id, artist_id, shares::text AS s FROM next_holdings ORDER BY id').all()) as unknown[];

    await restoreBackup('pre-phase-1.json.gz');

    expect(await db.prepare('SELECT id, next_credits_cents FROM users ORDER BY id').all()).toEqual(balancesBefore);
    expect(await db.prepare('SELECT user_id, artist_id, shares::text AS s FROM next_holdings ORDER BY id').all()).toEqual(holdingsBefore);
    expect((await verifyMarketMigration()).ok).toBe(true);
    expect((await reconcileMarket()).issues).toEqual([]);
  });
});
