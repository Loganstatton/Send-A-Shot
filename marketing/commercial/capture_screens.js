// Captures real NEXT app screens for the commercial: the live app, run
// locally on a fresh database seeded with invented artists and players and
// a month of trading history (no real people). Phone screens are 390x844 at
// 4x (1560x3376, sharp in close-ups); floating artist cards are cropped from
// the desktop grid.
//
// The story the ad tells, all produced by the app's own market engine:
// Juno Marrow is brand new with no backers; Maya buys first on camera
// (Backer #1 → Genesis Founder); then the other players pile in and the
// price climbs. The real numbers are written to juno.json for the captions.
//
//   npm run db:dev && npm run build   (repo root, once)
//   node marketing/commercial/capture_screens.js OUT_DIR COVERS_DIR
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.resolve(process.argv[2] || 'screens');
const COVERS = path.resolve(process.argv[3] || 'demo');
const DB = process.env.E2E_DEV_DB || 'postgresql://postgres@127.0.0.1:54329/sas_dev';
const SCHEMA = `ad_${Date.now()}`;
const PORT = 3130, BASE = `http://localhost:${PORT}`;
const sql = (q) => execFileSync('psql', [DB, '-At', '-c', `SET search_path=${SCHEMA}; ${q}`], { encoding: 'utf8' }).trim().split('\n').pop();

const ARTISTS = [
  // name, genre, score (1–10 categories), cover, bio
  ['Velvet Static', 'Indie', 8, 1, 'Fuzzed-out bedroom indie with hooks that stick for days.'],
  ['Juno Marrow', 'R&B', 9, 5, 'Late-night R&B: smoky vocals over warm, slow-burning keys.'],
  ['Sol Kaito', 'Electronic', 8, 3, 'Glowing club electronics built from field recordings.'],
  ['The Glass Arcade', 'Rock/Alternative', 7, 2, 'Four-piece alt-rock with huge, shimmering choruses.'],
  ['Mira Solace', 'Pop', 8, 8, 'Bright, confessional pop with a dancefloor heartbeat.'],
  ['Dex Vandal', 'Hip-Hop/Rap', 7, 4, 'Sharp, fast-talking rap over cinematic beats.'],
  ['Coral Thief', 'Indie', 7, 7, 'Dreamy guitar pop recorded in a converted garage.'],
  ['Ashby Lane', 'Country', 6, 6, 'Modern country storytelling with a rock edge.'],
];
const PLAYERS = ['Maya Chen', 'Leo Brandt', 'Priya Nair', 'Sam Okoro', 'Hana Ito', 'Diego Ruiz', 'Zoe Park', 'Marcus Webb',
  'Ines Duarte', 'Theo Grant', 'Aisha Bello', 'Noah Fischer', 'Lena Novak', 'Omar Haddad', 'Ruby Shaw'];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  // Serve the invented cover art from the app's own public folder while capturing.
  const pub = path.join(ROOT, 'public', 'demo-ad');
  fs.mkdirSync(pub, { recursive: true });
  for (const f of fs.readdirSync(COVERS)) fs.copyFileSync(path.join(COVERS, f), path.join(pub, f));
  const server = spawn('npx', ['next', 'start', '-p', String(PORT)], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: { ...process.env, DATABASE_URL: DB, DATABASE_SCHEMA: SCHEMA, ADMIN_EMAILS: 'founder@example.com', APP_URL: BASE, NODE_ENV: 'production' } });
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
    const browser = await chromium.launch();
    const mk = async (name, email, opts = {}) => {
      const ctx = await browser.newContext({ baseURL: BASE, ...opts });
      await ctx.request.post('/api/auth/signup', { data: { name, email, password: 'commercial-123', tosAccepted: true, privacyAccepted: true } });
      await ctx.request.post('/api/next/onboarding/complete');
      return ctx;
    };
    const admin = await mk('Founder', 'founder@example.com');
    const ids = {};
    for (const [name, genre, r, cover, bio] of ARTISTS) {
      const s = (d) => Math.max(1, Math.min(10, r + d));
      const res = await admin.request.post('/api/artists', { data: { name, genre, bio, score_rationale: 'Distinctive songwriting and a fast-growing, engaged audience.',
        music_talent: s(1), growth_velocity: s(0), engagement_quality: s(0), original_song_response: s(1), brand_personality: s(0), content_consistency: s(-1), commercial_potential: s(0), professionalism: s(0) } });
      const id = (await res.json()).id;
      ids[name] = id;
      sql(`UPDATE artists SET photo_url = '/demo-ad/cover${cover}.jpg' WHERE id = ${id};`);
    }
    // Players and their trades (bought "over the past month" — backdated below).
    const players = [];
    for (const [i, n] of PLAYERS.entries()) players.push(await mk(n, `player${i}@example.com`));
    const maya = players[0];
    let k = 0;
    const buy = (ctx, a, dollars) => ctx.request.post(`/api/next/artists/${ids[a]}/trade`, { data: { type: 'buy', credits_amount_cents: dollars * 100, idempotencyKey: `s${k++}` } });
    const sell = (ctx, a, dollars) => ctx.request.post(`/api/next/artists/${ids[a]}/trade`, { data: { type: 'sell', credits_amount_cents: dollars * 100, idempotencyKey: `s${k++}` } });
    // Maya backs early (cheap); the crowd piles in later, so her picks are up.
    await buy(maya, 'Velvet Static', 3400); await buy(maya, 'Sol Kaito', 2800); await buy(maya, 'Mira Solace', 2100); await buy(maya, 'Coral Thief', 600);
    const others = players.slice(1);
    for (const [j, p] of others.entries()) {
      await buy(p, 'Velvet Static', 2600 + (j * 173) % 900);
      await buy(p, 'Sol Kaito', 2100 + (j * 211) % 800);
      await buy(p, 'Mira Solace', 1600 + (j * 97) % 700);
      if (j % 2) await buy(p, ['The Glass Arcade', 'Dex Vandal', 'Ashby Lane', 'Coral Thief'][j % 4], 900);
      if (j % 4 === 3) await sell(p, 'Sol Kaito', 700);      // a few dips on the way up
    }
    // Spread everything so far over the last 28 days, in order.
    const spread = (table, col) => sql(`UPDATE ${table} t SET ${col} = to_char(((now() at time zone 'UTC') - interval '28 days') + (r.rn::float / (r.cnt + 1)) * interval '27 days', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM (SELECT id, row_number() over (order by id) rn, count(*) over () cnt FROM ${table}) r WHERE t.id = r.id;`);
    spread('next_price_history', 'recorded_at');
    spread('next_transactions', 'created_at');
    sql(`UPDATE next_founding_believers f SET purchased_at = (SELECT MIN(created_at) FROM next_transactions t WHERE t.user_id = f.user_id AND t.artist_id = f.artist_id AND t.type = 'buy');`);

    // ---- phone screens, as Maya
    const phone = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 }, deviceScaleFactor: 4, isMobile: true, hasTouch: true,
      storageState: await maya.storageState() });
    const page = await phone.newPage();
    const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); console.log('screen', name); };
    await page.goto('/next', { waitUntil: 'networkidle' }); await shot('01-discover');
    await page.evaluate(() => document.getElementById('artists')?.scrollIntoView()); await shot('02-discover-grid');
    await page.goto(`/next/artists/${ids['Juno Marrow']}`, { waitUntil: 'networkidle' }); await shot('03-artist');
    const form = page.locator('form', { has: page.getByRole('button', { name: /Review purchase/ }) });
    await form.scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollBy(0, -120));
    await form.getByRole('button', { name: '$250', exact: false }).first().click().catch(async () => {
      await form.locator('input').first().fill('250');
    });
    await shot('04-back-amount');
    await form.getByRole('button', { name: /Review purchase/ }).click(); await shot('05-confirm');
    await page.getByRole('button', { name: /Confirm purchase/ }).click();
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(1200);
    await page.evaluate(() => window.scrollBy(0, -80)); await shot('06-backed');
    const juno = ids['Juno Marrow'];
    const mayaBuy = JSON.parse(sql(`SELECT json_build_object('price', price_cents_per_share, 'shares', shares, 'credits', -credits_delta_cents) FROM next_transactions WHERE artist_id = ${juno} ORDER BY id LIMIT 1;`));
    // The crowd finds Juno after Maya: each player spends most of what they have left.
    for (const [i] of others.entries()) {
      const cash = Number(sql(`SELECT next_credits_cents FROM users WHERE email = 'player${i + 1}@example.com';`));
      const dollars = Math.min(2600, Math.floor(cash / 100) - 60);
      if (dollars > 100) await buy(others[i], 'Juno Marrow', dollars);
    }
    await page.goto(`/next/artists/${juno}`, { waitUntil: 'networkidle' }); await shot('10-artist-chart');
    await page.goto('/next/portfolio', { waitUntil: 'networkidle' }); await shot('07-portfolio');
    await page.evaluate(() => window.scrollBy(0, 640)); await shot('07b-holdings');
    await page.goto('/next/leaderboard', { waitUntil: 'networkidle' }); await shot('08-leaderboard');
    await page.evaluate(() => window.scrollBy(0, 330)); await shot('08b-leaderboard-rows');
    await page.goto(`/next/artists/${juno}/founding-believer`, { waitUntil: 'networkidle' }); await shot('09-founding-believer');
    const fb = JSON.parse(sql(`SELECT json_build_object('rank', f.discovery_rank, 'at', f.purchased_at) FROM next_founding_believers f JOIN users u ON u.id = f.user_id WHERE f.artist_id = ${juno} AND u.email = 'player0@example.com';`));
    const now = Number(sql(`SELECT next_current_price_cents FROM artists WHERE id = ${juno};`));
    const hist = sql(`SELECT string_agg(price_cents::text, ',' ORDER BY recorded_at, id) FROM next_price_history WHERE artist_id = ${juno};`).split(',').filter(Boolean).map(Number);
    fs.writeFileSync(path.join(OUT, 'juno.json'), JSON.stringify({ buy: mayaBuy, price_now_cents: now, history: hist, founding_believer: fb,
      backers: Number(sql(`SELECT count(DISTINCT user_id) FROM next_transactions WHERE artist_id = ${juno} AND type = 'buy';`)) }, null, 2));
    // The Founding Believer card on its own, for reference.
    await page.goto(`/next/artists/${juno}/founding-believer`, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: '.holo-card-idle, .holo-card-idle-shine { animation: none !important; } .holo-card-tilt { transform: none !important; }' });
    await page.waitForTimeout(400);
    await page.locator('#founding-believer-receipt').screenshot({ path: path.join(OUT, 'card-founding-believer.png') });
    // Price histories (in-app, from the seeded trades) for the 3D charts.
    const series = {};
    for (const [name, id] of Object.entries(ids)) {
      series[name] = sql(`SELECT string_agg(price_cents::text, ',' ORDER BY recorded_at, id) FROM next_price_history WHERE artist_id = ${id};`).split(',').filter(Boolean).map(Number);
    }
    fs.writeFileSync(path.join(OUT, 'series.json'), JSON.stringify(series));

    // ---- floating cards from the desktop grid (2x)
    const desk = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2, storageState: await maya.storageState() });
    const dp = await desk.newPage();
    await dp.goto('/next', { waitUntil: 'networkidle' });
    await dp.evaluate(() => document.getElementById('artists')?.scrollIntoView());
    await dp.waitForTimeout(600);
    const cards = dp.locator('#artists .next-card');
    const n = Math.min(await cards.count(), 8);
    for (let i = 0; i < n; i++) { await cards.nth(i).screenshot({ path: path.join(OUT, `card-${i + 1}.png`) }); }
    console.log('cards', n);
    fs.writeFileSync(path.join(OUT, 'ids.json'), JSON.stringify(ids, null, 2));
    await browser.close();
  } finally {
    process.kill(-server.pid);
    fs.rmSync(pub, { recursive: true, force: true });
  }
})();
