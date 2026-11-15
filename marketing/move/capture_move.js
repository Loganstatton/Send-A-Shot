// Captures the real NEXT screens for "THE MOVE" and runs its illustrative trade through the real app.
//
// The app runs locally against a fresh schema on the local dev Postgres, seeded only with invented
// artists and demo players. There are no real people, no production data, and no app code is changed.
// Every trade below goes through NEXT's own trade API and its own trading engine (price impact,
// average-price execution, sell-all cap). After each step the script checks the app's stored numbers
// against scenario.js and stops if a single cent differs.
//
// The story (all demo data, labelled as illustrative in the film):
//   1. The account "Demo Player" starts with NEXT's standard 10,000 virtual Credits. In Discover it
//      selects Kito Vale, an invented emerging artist the scouts rated 62.5, listed at $22.03.
//   2. It backs her: $4,500 through the real Buy panel (Review purchase, then Confirm). This is the
//      first trade on the artist.
//   3. Other demo players trade over the following days. Each trade moves the price by the app's rule.
//   4. Sell all, through the real Sell panel. Realized P&L is +$1,432.00 and the balance is $11,432.00.
//
//   npm run db:dev && npm run build   (repo root, once)
//   node marketing/move/capture_move.js OUT_DIR COVERS_DIR
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const SC = require('./scenario.js');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.resolve(process.argv[2] || 'screens');
const COVERS = path.resolve(process.argv[3] || 'demo');
const DB = process.env.E2E_DEV_DB || 'postgresql://postgres@127.0.0.1:54329/sas_dev';
const SCHEMA = `move_${Date.now()}`;
const PORT = 3133, BASE = `http://localhost:${PORT}`;
const sql = (q) => execFileSync('psql', [DB, '-At', '-c', `SET search_path=${SCHEMA}; ${q}`], { encoding: 'utf8' }).trim().split('\n').pop();
const must = (cond, msg) => { if (!cond) throw new Error('scenario check failed: ' + msg); console.log('  ok', msg); };

// A lively market around her (invented artists, abstract covers)
const ROSTER = [
  ['Velvet Static', 'Indie', 8, 1, 'Fuzzed-out bedroom indie with hooks that stick for days.'],
  ['Sol Kaito', 'Electronic', 8, 3, 'Glowing club electronics built from field recordings.'],
  ['The Glass Arcade', 'Rock/Alternative', 7, 2, 'Four-piece alt-rock with huge, shimmering choruses.'],
  ['Mira Solace', 'Pop', 8, 8, 'Bright, confessional pop with a dancefloor heartbeat.'],
  ['Dex Vandal', 'Hip-Hop/Rap', 7, 4, 'Sharp, fast-talking rap over cinematic beats.'],
  ['Coral Thief', 'Indie', 7, 7, 'Dreamy guitar pop recorded in a converted garage.'],
];
// The pick: ratings that sum (with the app's weights 25/15/15/15/10/10/5/5) to a NEXT Score of 62.5
const PICK = { name: 'Kito Vale', genre: 'Hip-Hop/Rap', cover: 6, bio: 'Melodic drill with huge, cinematic drops.',
  ratings: { music_talent: 7, growth_velocity: 6, engagement_quality: 6, original_song_response: 7, brand_personality: 6,
             content_consistency: 5, commercial_potential: 6, professionalism: 5 } };
const BACKGROUND = ['Leo Brandt', 'Priya Nair', 'Sam Okoro', 'Hana Ito', 'Diego Ruiz', 'Zoe Park'];
const CROWD_NAMES = ['Marcus Webb', 'Ines Duarte', 'Theo Grant', 'Aisha Bello', 'Noah Fischer', 'Lena Vos', 'Omar Haddad',
  'Kai Morgan', 'Ruth Adler', 'Jonas Berg', 'Mei Lin', 'Tomas Reyes', 'Ada Okafor', 'Felix Moreau'];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const pub = path.join(ROOT, 'public', 'demo-ad');
  fs.mkdirSync(pub, { recursive: true });
  for (const f of fs.readdirSync(COVERS)) fs.copyFileSync(path.join(COVERS, f), path.join(pub, f));
  const server = spawn('npx', ['next', 'start', '-p', String(PORT)], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: { ...process.env, DATABASE_URL: DB, DATABASE_SCHEMA: SCHEMA, ADMIN_EMAILS: 'scout@example.com', APP_URL: BASE, NODE_ENV: 'production' } });
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
    const browser = await chromium.launch();
    const mk = async (name, email) => {
      const ctx = await browser.newContext({ baseURL: BASE });
      await ctx.request.post('/api/auth/signup', { data: { name, email, password: 'commercial-123', tosAccepted: true, privacyAccepted: true } });
      await ctx.request.post('/api/next/onboarding/complete');
      return ctx;
    };
    const scout = await mk('Alex Rivera', 'scout@example.com');
    const ids = {};
    const addArtist = async (name, genre, bio, ratings, cover) => {
      const res = await scout.request.post('/api/artists', { data: { name, genre, bio, stage: 'development', score_rationale: 'Distinctive songwriting and an engaged audience.', ...ratings } });
      if (!res.ok()) throw new Error(`artist ${name}: ${res.status()} ${await res.text()}`);
      ids[name] = (await res.json()).id;
      sql(`UPDATE artists SET photo_url = '/demo-ad/cover${cover}.jpg' WHERE id = ${ids[name]};`);
    };
    for (const [name, genre, r, cover, bio] of ROSTER) {
      const s = (d) => Math.max(1, Math.min(10, r + d));
      await addArtist(name, genre, bio, { music_talent: s(1), growth_velocity: s(0), engagement_quality: s(0), original_song_response: s(1),
        brand_personality: s(0), content_consistency: s(-1), commercial_potential: s(0), professionalism: s(0) }, cover);
    }
    // the background market, spread over four weeks
    const bg = [];
    for (const [i, n] of BACKGROUND.entries()) bg.push(await mk(n, `bg${i}@example.com`));
    let k = 0;
    const trade = (ctx, id, type, cents) => ctx.request.post(`/api/next/artists/${id}/trade`, { data: { type, credits_amount_cents: cents, idempotencyKey: `t${k++}` } });
    for (const [j, p] of bg.entries()) {
      await trade(p, ids['Velvet Static'], 'buy', (1800 + (j * 173) % 700) * 100);
      await trade(p, ids['Sol Kaito'], 'buy', (1500 + (j * 211) % 600) * 100);
      if (j % 2) await trade(p, ids['Mira Solace'], 'buy', (900 + (j * 97) % 500) * 100);
    }
    const spread = (table, col, where = 'true') => sql(`UPDATE ${table} t SET ${col} = to_char(((now() at time zone 'UTC') - interval '28 days') + (r.rn::float / (r.cnt + 1)) * interval '14 days', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM (SELECT id, row_number() over (order by id) rn, count(*) over () cnt FROM ${table} WHERE ${where}) r WHERE t.id = r.id;`);
    spread('next_price_history', 'recorded_at'); spread('next_transactions', 'created_at');

    // the pick's artist
    await addArtist(PICK.name, PICK.genre, PICK.bio, PICK.ratings, PICK.cover);
    const kito = ids[PICK.name];
    const hero = await mk('Demo Player', 'demo@example.com');
    const crowd = [];
    for (const [i, n] of CROWD_NAMES.entries()) crowd.push(await mk(n, `crowd${i}@example.com`));

    // ---- NEXT, phone, as Demo Player
    const phone = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 }, deviceScaleFactor: 4, isMobile: true, hasTouch: true,
      storageState: await hero.storageState() });
    await phone.route(/img\.youtube\.com|i\.ytimg\.com/, (route) => route.fulfill({ path: path.join(COVERS, `cover${PICK.cover}.jpg`), contentType: 'image/jpeg' }));
    const page = await phone.newPage();
    const shot = async (name) => { await page.waitForTimeout(600); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); console.log('next', name); };
    const taps = {};
    const tap = async (name, loc) => { const b = await loc.boundingBox(); if (b) taps[name] = { u: (b.x + b.width / 2) / 390, v: (b.y + b.height / 2) / 844, w: b.width / 390, h: b.height / 844 }; };

    await page.goto('/next', { waitUntil: 'networkidle' }); await shot('m01-discover');
    await page.evaluate(() => document.getElementById('artists')?.scrollIntoView()); await shot('m02-discover-grid');
    const card = page.locator('#artists .next-card', { hasText: PICK.name }).first();
    await card.scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollBy(0, -160)); await shot('m02b-grid-pick');
    await tap('pick_card', card);
    const listing = Number(sql(`SELECT next_current_price_cents FROM artists WHERE id = ${kito};`)) || null;
    await card.click(); await page.waitForURL(/\/next\/artists\/\d+/); await page.waitForLoadState('networkidle'); await shot('m03-artist');
    await page.evaluate(() => window.scrollBy(0, 420)); await shot('m03b-artist-score'); await page.evaluate(() => window.scrollTo(0, 0));
    const L = Number(sql(`SELECT next_current_price_cents FROM artists WHERE id = ${kito};`));
    const plan = SC.solve(L, 143_200, SC.CROWD);
    must(plan && L === 2203, `listing price ${L} (score 62.5 lists at $22.03; listed before view: ${listing})`);
    fs.writeFileSync(path.join(OUT, 'plan.json'), JSON.stringify(plan, null, 2));

    // the pick, through the real Buy panel
    const tform = page.locator('form', { has: page.getByRole('button', { name: /Review purchase/ }) });
    await tform.scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollBy(0, -120)); await shot('m04a-trade-empty');
    await tap('amount', page.locator('#trade-panel-next-credits'));
    await page.locator('#trade-panel-next-credits').click(); await page.locator('#trade-panel-next-credits').fill('');
    await page.locator('#trade-panel-next-credits').pressSequentially(String(plan.pick / 100), { delay: 90 }); await shot('m04-buy-amount');
    await tap('review_buy', tform.getByRole('button', { name: /Review purchase/ }));
    await tform.getByRole('button', { name: /Review purchase/ }).click(); await shot('m05-buy-confirm');
    await tap('confirm_buy', page.getByRole('button', { name: /Confirm purchase/ }));
    await page.getByRole('button', { name: /Confirm purchase/ }).click();
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(1200);
    await page.evaluate(() => window.scrollBy(0, -80)); await shot('m06-bought');
    const heroBuy = JSON.parse(sql(`SELECT json_build_object('price', price_cents_per_share, 'shares', shares, 'credits', -credits_delta_cents) FROM next_transactions WHERE artist_id = ${kito} ORDER BY id LIMIT 1;`));
    must(heroBuy.price === plan.pickFill && Math.abs(heroBuy.shares - plan.shares) < 1e-9 && heroBuy.credits === plan.pick, `pick: ${heroBuy.shares} shares at ${heroBuy.price}`);
    must(Number(sql(`SELECT next_current_price_cents FROM artists WHERE id = ${kito};`)) === plan.afterPick, `price after pick ${plan.afterPick}`);

    // the market moves: other demo players, the app's own rule for every trade
    const seq = [...SC.CROWD, ['buy', plan.lastBuy]];
    let nextBuyer = 0, nextSeller = 0;
    for (const [side, cents] of seq) {
      const i = side === 'buy' ? nextBuyer++ : nextSeller++;      // the n-th sell comes from the n-th buyer (who holds shares)
      const r = await trade(crowd[i], kito, side, cents);
      if (!r.ok()) throw new Error(`crowd ${side} ${cents}: ${r.status()} ${await r.text()}`);
    }
    must(Number(sql(`SELECT next_current_price_cents FROM artists WHERE id = ${kito};`)) === plan.exit, `price after the market ${plan.exit}`);
    // time passes: listing 12 days ago, the pick 11 days ago, the market's trades across the days since
    const ago = (d) => `to_char((now() at time zone 'UTC') - interval '${d}', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
    sql(`UPDATE next_price_history t SET recorded_at = CASE WHEN r.rn = 1 THEN ${ago('12 days')} WHEN r.rn = 2 THEN ${ago('11 days')}
         ELSE to_char(((now() at time zone 'UTC') - interval '10 days') + ((r.rn - 2)::float / (r.cnt - 1)) * interval '9 days 20 hours', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END
         FROM (SELECT id, row_number() over (order by id) rn, count(*) over () cnt FROM next_price_history WHERE artist_id = ${kito}) r WHERE t.id = r.id;`);
    sql(`UPDATE next_transactions t SET created_at = h.recorded_at FROM (SELECT x.id, (SELECT recorded_at FROM next_price_history h2 WHERE h2.artist_id = ${kito} ORDER BY id OFFSET x.rn LIMIT 1) recorded_at
         FROM (SELECT id, row_number() over (order by id) rn FROM next_transactions WHERE artist_id = ${kito}) x) h WHERE t.id = h.id;`);
    sql(`UPDATE artists SET created_at = ${ago('12 days')} WHERE id = ${kito};`);
    sql(`UPDATE next_holdings SET updated_at = ${ago('11 days')} WHERE artist_id = ${kito} AND user_id = (SELECT id FROM users WHERE email = 'demo@example.com');`);

    await page.goto(`/next/artists/${kito}`, { waitUntil: 'networkidle' }); await shot('m07-artist-moved');
    const sform = page.locator('form', { has: page.getByRole('button', { name: /Review/ }) }).first();
    await sform.scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollBy(0, -120)); await shot('m07b-position');
    await page.goto('/next/portfolio', { waitUntil: 'networkidle' }); await shot('m08a-portfolio-holding');
    await page.goto('/next/activity', { waitUntil: 'networkidle' }); await shot('m08b-activity');

    // the sale, through the real Sell panel: Sell all
    await page.goto(`/next/artists/${kito}`, { waitUntil: 'networkidle' });
    await sform.scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollBy(0, -120));
    await tap('sell_tab', page.getByRole('button', { name: /^Sell$/ }).first());
    await page.getByRole('button', { name: /^Sell$/ }).first().click(); await shot('m09a-sell-tab');
    await tap('sell_all', page.getByRole('button', { name: 'Sell all' }));
    await page.getByRole('button', { name: 'Sell all' }).click(); await shot('m09b-sell-all');
    await tap('review_sell', page.getByRole('button', { name: /Review sale/ }));
    await page.getByRole('button', { name: /Review sale/ }).click(); await shot('m09c-sell-confirm');
    await tap('confirm_sell', page.getByRole('button', { name: /Confirm/ }).first());
    await page.getByRole('button', { name: /Confirm/ }).first().click();
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(1200);
    await page.evaluate(() => window.scrollBy(0, -80)); await shot('m10-sold');
    const heroSell = JSON.parse(sql(`SELECT json_build_object('price', price_cents_per_share, 'shares', shares, 'credits', credits_delta_cents, 'pnl', realized_pnl_cents) FROM next_transactions WHERE artist_id = ${kito} AND user_id = (SELECT id FROM users WHERE email = 'demo@example.com') AND type = 'sell';`));
    must(heroSell.price === plan.sale.fill && heroSell.credits === plan.sale.proceeds && heroSell.pnl === 143_200, `sale: ${heroSell.shares} shares at ${heroSell.price}, proceeds ${heroSell.credits}, realized ${heroSell.pnl}`);
    const bal = Number(sql(`SELECT next_credits_cents FROM users WHERE email = 'demo@example.com';`));
    must(bal === 1_143_200, `balance ${bal}`);

    await page.goto('/next/portfolio', { waitUntil: 'networkidle' }); await shot('m11-portfolio');
    await page.evaluate(() => window.scrollBy(0, 360)); await shot('m11b-portfolio-history');
    await page.goto('/next/leaderboard', { waitUntil: 'networkidle' }); await shot('m12-leaderboard');
    await page.goto(`/next/artists/${kito}`, { waitUntil: 'networkidle' }); await shot('m13-artist-after');

    const series = sql(`SELECT string_agg(price_cents::text, ',' ORDER BY recorded_at, id) FROM next_price_history WHERE artist_id = ${kito};`).split(',').map(Number);
    const tx = JSON.parse(sql(`SELECT json_agg(json_build_object('type', type, 'cents', abs(credits_delta_cents), 'price', price_cents_per_share, 'at', created_at, 'hero', user_id = (SELECT id FROM users WHERE email = 'demo@example.com')) ORDER BY created_at, id) FROM next_transactions WHERE artist_id = ${kito};`));
    fs.writeFileSync(path.join(OUT, 'taps.json'), JSON.stringify(taps, null, 2));
    fs.writeFileSync(path.join(OUT, 'journey.json'), JSON.stringify({ artist_id: kito, ratings: PICK.ratings, listing: L, plan, hero_buy: heroBuy, hero_sell: heroSell,
      balance_cents: bal, series, trades: tx }, null, 2));
    // desktop cards for the floating displays (2x)
    const nd = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2, storageState: await hero.storageState() });
    const np = await nd.newPage();
    await np.goto('/next', { waitUntil: 'networkidle' });
    await np.evaluate(() => document.getElementById('artists')?.scrollIntoView()); await np.waitForTimeout(600);
    const cards = np.locator('#artists .next-card'); const n = Math.min(await cards.count(), 8);
    for (let i = 0; i < n; i++) await cards.nth(i).screenshot({ path: path.join(OUT, `card-${i + 1}.png`) });
    await np.goto(`/next/artists/${kito}`, { waitUntil: 'networkidle' }); await np.screenshot({ path: path.join(OUT, 'd-artist.png'), fullPage: true });
    await np.goto('/next/portfolio', { waitUntil: 'networkidle' }); await np.screenshot({ path: path.join(OUT, 'd-portfolio.png'), fullPage: true });
    console.log('cards', n);
    await browser.close();
  } finally {
    process.kill(-server.pid);
    fs.rmSync(pub, { recursive: true, force: true });
  }
})();
