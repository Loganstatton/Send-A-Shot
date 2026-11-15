// Captures real SCOUT and NEXT screens for "BEFORE THE BREAKOUT": the live
// app, run locally on a fresh database schema seeded only with invented
// artists and players (no real people, no production data).
//
// The journey is performed through the app's own routes, in order:
//   1. A NEXT player submits Juno Marrow with "Submit an Artist" (a real
//      public feature); two other demo fans submit other demo artists.
//   2. SCOUT: the candidate sits in the New Candidates queue; a scout (the
//      demo admin) approves it — a human action, nothing automatic.
//   3. SCOUT: the scout rates the eight categories; the weighted score is
//      what NEXT shows as the NEXT Score.
//   4. NEXT: Juno is now listed; Maya opens her, backs her first (Backer #1),
//      then the crowd follows; portfolio, leaderboard, Founding Believer.
// Desktop SCOUT shots are 1600x900 at 2x (3200x1800, for the 3D monitors);
// phone NEXT shots are 390x844 at 4x (1560x3376).
// Never captured: the artist page's deals/revenue/investment sections, the
// Screener's money totals, sync credentials, emails or internal notes.
//
//   npm run db:dev && npm run build   (repo root, once)
//   node marketing/dual/capture_dual.js OUT_DIR COVERS_DIR
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.resolve(process.argv[2] || 'screens');
const COVERS = path.resolve(process.argv[3] || 'demo');
const DB = process.env.E2E_DEV_DB || 'postgresql://postgres@127.0.0.1:54329/sas_dev';
const SCHEMA = `dual_${Date.now()}`;
const PORT = 3131, BASE = `http://localhost:${PORT}`;
const sql = (q) => execFileSync('psql', [DB, '-At', '-c', `SET search_path=${SCHEMA}; ${q}`], { encoding: 'utf8' }).trim().split('\n').pop();

// Already on SCOUT's roster (rated earlier), at different lifecycle stages.
const ROSTER = [
  // name, genre, base rating, cover, stage, bio
  ['Velvet Static', 'Indie', 8, 1, 'portfolio', 'Fuzzed-out bedroom indie with hooks that stick for days.'],
  ['Sol Kaito', 'Electronic', 8, 3, 'development', 'Glowing club electronics built from field recordings.'],
  ['The Glass Arcade', 'Rock/Alternative', 7, 2, 'contacted', 'Four-piece alt-rock with huge, shimmering choruses.'],
  ['Mira Solace', 'Pop', 8, 8, 'development', 'Bright, confessional pop with a dancefloor heartbeat.'],
  ['Dex Vandal', 'Hip-Hop/Rap', 7, 4, 'watchlist', 'Sharp, fast-talking rap over cinematic beats.'],
  ['Coral Thief', 'Indie', 7, 7, 'watchlist', 'Dreamy guitar pop recorded in a converted garage.'],
];
// Fan submissions waiting in SCOUT's queue (Juno is the one we follow).
const SUBMISSIONS = [
  ['Juno Marrow', 'Late-night R&B with smoky vocals over warm, slow-burning keys. Her new single keeps getting shared in my group chats.'],
  ['Halden Rae', 'Folk songwriter whose live sessions keep showing up in my feed. Great lyrics.'],
  ['Kito Vale', 'Melodic drill producer-rapper. Every drop sounds huge.'],
];
const PLAYERS = ['Maya Chen', 'Leo Brandt', 'Priya Nair', 'Sam Okoro', 'Hana Ito', 'Diego Ruiz', 'Zoe Park', 'Marcus Webb',
  'Ines Duarte', 'Theo Grant', 'Aisha Bello', 'Noah Fischer'];
const JUNO_RATINGS = { music_talent: 9, growth_velocity: 8, engagement_quality: 9, original_song_response: 9,
  brand_personality: 8, content_consistency: 8, commercial_potential: 8, professionalism: 9 };

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
    const scout = await mk('Alex Rivera', 'scout@example.com');           // the demo scout (internal)
    const ids = {};
    for (const [name, genre, r, cover, stage, bio] of ROSTER) {
      const s = (d) => Math.max(1, Math.min(10, r + d));
      const res = await scout.request.post('/api/artists', { data: { name, genre, bio, stage, score_rationale: 'Distinctive songwriting and an engaged audience.',
        music_talent: s(1), growth_velocity: s(0), engagement_quality: s(0), original_song_response: s(1), brand_personality: s(0), content_consistency: s(-1), commercial_potential: s(0), professionalism: s(0) } });
      ids[name] = (await res.json()).id;
      sql(`UPDATE artists SET photo_url = '/demo-ad/cover${cover}.jpg' WHERE id = ${ids[name]};`);
    }
    const players = [];
    for (const [i, n] of PLAYERS.entries()) players.push(await mk(n, `player${i}@example.com`));
    const maya = players[0];
    let k = 0;
    const buy = (ctx, a, dollars) => ctx.request.post(`/api/next/artists/${ids[a]}/trade`, { data: { type: 'buy', credits_amount_cents: dollars * 100, idempotencyKey: `d${k++}` } });
    // Some market history on the existing roster, so NEXT looks lived-in.
    for (const [j, p] of players.slice(1).entries()) {
      await buy(p, 'Velvet Static', 1800 + (j * 173) % 700);
      await buy(p, 'Sol Kaito', 1500 + (j * 211) % 600);
      if (j % 2) await buy(p, 'Mira Solace', 900 + (j * 97) % 500);
    }
    const spread = (table, col) => sql(`UPDATE ${table} t SET ${col} = to_char(((now() at time zone 'UTC') - interval '28 days') + (r.rn::float / (r.cnt + 1)) * interval '27 days', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM (SELECT id, row_number() over (order by id) rn, count(*) over () cnt FROM ${table}) r WHERE t.id = r.id;`);
    spread('next_price_history', 'recorded_at');
    spread('next_transactions', 'created_at');

    // 1. Fans submit artists through NEXT's real "Submit an Artist".
    for (const [i, [name, pitch]] of SUBMISSIONS.entries()) {
      const r = await players[[0, 4, 7][i]].request.post('/api/next/submit-artist', { data: { name, pitch } });
      if (!r.ok()) throw new Error(`submit ${name}: ${r.status()} ${await r.text()}`);
    }

    // ---- SCOUT, desktop
    const desk = await browser.newContext({ baseURL: BASE, viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2, storageState: await scout.storageState() });
    const dp = await desk.newPage();
    const dshot = async (name, loc) => { await dp.waitForTimeout(500); if (loc) await loc.screenshot({ path: path.join(OUT, `${name}.png`) }); else await dp.screenshot({ path: path.join(OUT, `${name}.png`) }); console.log('scout', name); };
    await dp.goto('/', { waitUntil: 'networkidle' }); await dshot('s01-roster');
    await dp.goto('/discovery', { waitUntil: 'networkidle' }); await dshot('s02-queue');
    const junoCard = dp.locator('.card', { hasText: 'Juno Marrow' }).first();
    await dshot('s02b-juno-candidate', junoCard);

    // 2. The scout approves Juno (the same button a person clicks).
    await junoCard.getByRole('button', { name: 'Approve' }).click();
    await dp.waitForURL(/\/artists\/\d+/, { timeout: 30000 });
    await dp.waitForLoadState('networkidle');
    const juno = Number(dp.url().match(/artists\/(\d+)/)[1]);
    ids['Juno Marrow'] = juno;
    sql(`UPDATE artists SET photo_url = '/demo-ad/cover5.jpg', genre = 'R&B', bio = 'Late-night R&B: smoky vocals over warm, slow-burning keys.' WHERE id = ${juno};`);
    await dp.reload({ waitUntil: 'networkidle' });
    const header = dp.locator('div.space-y-6 > div').first();
    await dshot('s03-approved-header', header);
    await dshot('s03b-approved-page');

    // 3. The scout rates the eight categories (human evaluation), then saves.
    const r = await scout.request.patch(`/api/artists/${juno}`, { data: { ...JUNO_RATINGS, stage: 'development',
      score_rationale: 'Standout voice and songwriting; strong response to her originals.' } });
    if (!r.ok()) throw new Error(`rate: ${r.status()} ${await r.text()}`);
    await dp.reload({ waitUntil: 'networkidle' });
    await dshot('s04-rated-header', dp.locator('div.space-y-6 > div').first());
    await dshot('s04b-breakdown', dp.locator('div.space-y-6 > *').nth(1));
    const form = dp.locator('form').last();
    await form.scrollIntoViewIfNeeded();
    await dshot('s05-scorecard-form', form);
    await dp.goto('/', { waitUntil: 'networkidle' }); await dshot('s06-roster-after');
    await dp.goto('/admin/discovery', { waitUntil: 'networkidle' }); await dshot('s07-discovery-dashboard');

    // ---- NEXT, phone, as Maya (who submitted Juno)
    const phone = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 }, deviceScaleFactor: 4, isMobile: true, hasTouch: true,
      storageState: await maya.storageState() });
    const page = await phone.newPage();
    const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); console.log('next', name); };
    await page.goto('/next', { waitUntil: 'networkidle' }); await shot('n01-discover');
    await page.evaluate(() => document.getElementById('artists')?.scrollIntoView()); await shot('n02-discover-grid');
    await page.goto(`/next/artists/${juno}`, { waitUntil: 'networkidle' }); await shot('n03-artist');
    await page.evaluate(() => window.scrollBy(0, 420)); await shot('n03b-artist-score');
    await page.goto(`/next/artists/${juno}`, { waitUntil: 'networkidle' });
    const tform = page.locator('form', { has: page.getByRole('button', { name: /Review purchase/ }) });
    await tform.scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollBy(0, -120));
    await tform.getByRole('button', { name: '$250', exact: false }).first().click().catch(async () => { await tform.locator('input').first().fill('250'); });
    await shot('n04-back-amount');
    await tform.getByRole('button', { name: /Review purchase/ }).click(); await shot('n05-confirm');
    await page.getByRole('button', { name: /Confirm purchase/ }).click();
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(1200);
    await page.evaluate(() => window.scrollBy(0, -80)); await shot('n06-backed');
    const mayaBuy = JSON.parse(sql(`SELECT json_build_object('price', price_cents_per_share, 'shares', shares, 'credits', -credits_delta_cents) FROM next_transactions WHERE artist_id = ${juno} ORDER BY id LIMIT 1;`));
    // The crowd follows after Maya.
    for (const [i, p] of players.slice(1).entries()) {
      const cash = Number(sql(`SELECT next_credits_cents FROM users WHERE email = 'player${i + 1}@example.com';`));
      const dollars = Math.min(1800, Math.floor(cash / 100) - 60);
      if (dollars > 100) await p.request.post(`/api/next/artists/${juno}/trade`, { data: { type: 'buy', credits_amount_cents: dollars * 100, idempotencyKey: `c${k++}` } });
    }
    await page.goto(`/next/artists/${juno}`, { waitUntil: 'networkidle' }); await shot('n07-artist-chart');
    await page.goto('/next/portfolio', { waitUntil: 'networkidle' }); await shot('n08-portfolio');
    await page.goto('/next/leaderboard', { waitUntil: 'networkidle' }); await shot('n09-leaderboard');
    await page.evaluate(() => window.scrollBy(0, 330)); await shot('n09b-leaderboard-rows');
    await page.goto(`/next/artists/${juno}/founding-believer`, { waitUntil: 'networkidle' }); await shot('n10-founding-believer');
    const fb = JSON.parse(sql(`SELECT json_build_object('rank', f.discovery_rank, 'at', f.purchased_at) FROM next_founding_believers f JOIN users u ON u.id = f.user_id WHERE f.artist_id = ${juno} AND u.email = 'player0@example.com';`));
    const series = {};
    for (const [name, id] of Object.entries(ids)) {
      series[name] = sql(`SELECT string_agg(price_cents::text, ',' ORDER BY recorded_at, id) FROM next_price_history WHERE artist_id = ${id};`).split(',').filter(Boolean).map(Number);
    }
    const score = sql(`SELECT json_build_object('next_price', next_current_price_cents) FROM artists WHERE id = ${juno};`);
    fs.writeFileSync(path.join(OUT, 'series.json'), JSON.stringify(series));
    fs.writeFileSync(path.join(OUT, 'journey.json'), JSON.stringify({ juno_id: juno, ratings: JUNO_RATINGS, maya_buy: mayaBuy, founding_believer: fb, artist: JSON.parse(score) }, null, 2));
    // Floating NEXT cards (desktop grid, 2x)
    const nd = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2, storageState: await maya.storageState() });
    const np = await nd.newPage();
    await np.goto('/next', { waitUntil: 'networkidle' });
    await np.evaluate(() => document.getElementById('artists')?.scrollIntoView()); await np.waitForTimeout(600);
    const cards = np.locator('#artists .next-card');
    const n = Math.min(await cards.count(), 8);
    for (let i = 0; i < n; i++) await cards.nth(i).screenshot({ path: path.join(OUT, `ncard-${i + 1}.png`) });
    console.log('cards', n);
    await browser.close();
  } finally {
    process.kill(-server.pid);
    fs.rmSync(pub, { recursive: true, force: true });
  }
})();
