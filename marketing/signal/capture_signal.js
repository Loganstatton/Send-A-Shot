// Captures real SCOUT and NEXT screens for "THE SIGNAL": the live app, run locally on a fresh
// database schema seeded only with invented artists and players (no real people, no production
// data, no app code changed). Adapted from ../dual/capture_dual.js.
//
// The journey, through the app's own routes and buttons:
//   1. Fans submit artists with NEXT's real "Submit an Artist"; they wait in SCOUT's New Candidates.
//   2. SCOUT: a scout (demo admin) approves Juno Marrow: a human click. That lists her on NEXT.
//   3. SCOUT: the scout moves the eight rating sliders by hand, four at a time, and saves.
//   4. NEXT (phone, as the demo player Maya): Discover, search, filters, Juno's profile, Watch,
//      the trade panel (10,000 Credits), buy, the crowd follows, a small sell, portfolio,
//      leaderboard, feed, watchlist, Founding Believer.
// Zero people: the demo covers are abstract; the profile's video thumbnail request is answered
// with the artist's abstract cover (a demo video id is set; the video is never played).
// SCOUT shots are ultrawide: the app's full content width (1536 px) at 21:9, 2.735x = 4201x1800; phone shots are
// 390x844 at 4x (1560x3376). Never captured: deals/revenue/investment, Screener money totals,
// sync credentials, emails, internal notes.
//
//   npm run db:dev && npm run build   (repo root, once)
//   node marketing/signal/capture_signal.js OUT_DIR COVERS_DIR
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.resolve(process.argv[2] || 'screens');
const COVERS = path.resolve(process.argv[3] || 'demo');
const DB = process.env.E2E_DEV_DB || 'postgresql://postgres@127.0.0.1:54329/sas_dev';
const SCHEMA = `signal_${Date.now()}`;
const PORT = 3132, BASE = `http://localhost:${PORT}`;
const sql = (q) => execFileSync('psql', [DB, '-At', '-c', `SET search_path=${SCHEMA}; ${q}`], { encoding: 'utf8' }).trim().split('\n').pop();

const ROSTER = [
  ['Velvet Static', 'Indie', 8, 1, 'portfolio', 'Fuzzed-out bedroom indie with hooks that stick for days.'],
  ['Sol Kaito', 'Electronic', 8, 3, 'development', 'Glowing club electronics built from field recordings.'],
  ['The Glass Arcade', 'Rock/Alternative', 7, 2, 'contacted', 'Four-piece alt-rock with huge, shimmering choruses.'],
  ['Mira Solace', 'Pop', 8, 8, 'development', 'Bright, confessional pop with a dancefloor heartbeat.'],
  ['Dex Vandal', 'Hip-Hop/Rap', 7, 4, 'watchlist', 'Sharp, fast-talking rap over cinematic beats.'],
  ['Coral Thief', 'Indie', 7, 7, 'watchlist', 'Dreamy guitar pop recorded in a converted garage.'],
];
const SUBMISSIONS = [
  ['Juno Marrow', 'Late-night R&B with smoky vocals over warm, slow-burning keys. Her new single keeps getting shared in my group chats.'],
  ['Halden Rae', 'Folk songwriter whose live sessions keep showing up in my feed. Great lyrics.'],
  ['Kito Vale', 'Melodic drill producer-rapper. Every drop sounds huge.'],
];
const PLAYERS = ['Maya Chen', 'Leo Brandt', 'Priya Nair', 'Sam Okoro', 'Hana Ito', 'Diego Ruiz', 'Zoe Park', 'Marcus Webb',
  'Ines Duarte', 'Theo Grant', 'Aisha Bello', 'Noah Fischer'];
// The scout's own rating, set by hand one column of the app's two-column panel at a time
// (left column, then right; same values as the dual ad: 86.0)
const GROUP1 = { music_talent: 9, engagement_quality: 9, brand_personality: 8, commercial_potential: 8 };
const GROUP2 = { growth_velocity: 8, original_song_response: 9, content_consistency: 8, professionalism: 9 };
const DEMO_VIDEO = 'dEm0SiGnAl1';

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
    for (const [j, p] of players.slice(1).entries()) {
      await buy(p, 'Velvet Static', 1800 + (j * 173) % 700);
      await buy(p, 'Sol Kaito', 1500 + (j * 211) % 600);
      if (j % 2) await buy(p, 'Mira Solace', 900 + (j * 97) % 500);
    }
    const spread = (table, col) => sql(`UPDATE ${table} t SET ${col} = to_char(((now() at time zone 'UTC') - interval '28 days') + (r.rn::float / (r.cnt + 1)) * interval '27 days', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM (SELECT id, row_number() over (order by id) rn, count(*) over () cnt FROM ${table}) r WHERE t.id = r.id;`);
    spread('next_price_history', 'recorded_at');
    spread('next_transactions', 'created_at');

    for (const [i, [name, pitch]] of SUBMISSIONS.entries()) {
      const r = await players[[0, 4, 7][i]].request.post('/api/next/submit-artist', { data: { name, pitch } });
      if (!r.ok()) throw new Error(`submit ${name}: ${r.status()} ${await r.text()}`);
    }

    // ---- SCOUT, ultrawide desktop
    const desk = await browser.newContext({ baseURL: BASE, viewport: { width: 1536, height: 658 }, deviceScaleFactor: 2.735, storageState: await scout.storageState() });
    const dp = await desk.newPage();
    const dshot = async (name, loc) => { await dp.waitForTimeout(500); if (loc) await loc.screenshot({ path: path.join(OUT, `${name}.png`) }); else await dp.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }); console.log('scout', name); };
    await dp.goto('/', { waitUntil: 'networkidle' }); await dshot('s01-roster');
    await dp.goto('/discovery', { waitUntil: 'networkidle' }); await dshot('s02-queue');
    const junoCard = dp.locator('.card', { hasText: 'Juno Marrow' }).first();
    await junoCard.scrollIntoViewIfNeeded(); await dshot('s02b-juno-candidate', junoCard);
    await junoCard.getByRole('button', { name: 'Approve' }).hover(); await dshot('s02c-juno-approve-hover', junoCard);
    await dp.goto('/admin/discovery', { waitUntil: 'networkidle' }); await dshot('s02d-discovery-dashboard');
    await dp.goto('/discovery', { waitUntil: 'networkidle' });

    // 2. The scout approves Juno (the button a person clicks). This lists her on NEXT at 50.0.
    await dp.locator('.card', { hasText: 'Juno Marrow' }).first().getByRole('button', { name: 'Approve' }).click();
    await dp.waitForURL(/\/artists\/\d+/, { timeout: 30000 });
    await dp.waitForLoadState('networkidle');
    const juno = Number(dp.url().match(/artists\/(\d+)/)[1]);
    ids['Juno Marrow'] = juno;
    sql(`UPDATE artists SET photo_url = '/demo-ad/cover5.jpg', genre = 'R&B', bio = 'Late-night R&B: smoky vocals over warm, slow-burning keys.', featured_video_id = '${DEMO_VIDEO}' WHERE id = ${juno};`);
    await dp.reload({ waitUntil: 'networkidle' });
    await dshot('s03-approved-header', dp.locator('div.space-y-6 > div').first());
    await dshot('s03b-approved-page');
    await dp.goto('/discovery', { waitUntil: 'networkidle' }); await dshot('s03c-queue-after');
    await dp.goto('/admin/discovery', { waitUntil: 'networkidle' }); await dshot('s03d-dashboard-after');

    // 3. The scout rates by hand: four sliders, then four more, then saves.
    await dp.goto(`/artists/${juno}`, { waitUntil: 'networkidle' });
    // capture-only: un-stick the app header so it doesn't cover the panel in element screenshots (no app change)
    await dp.addStyleTag({ content: 'header, .sticky { position: static !important; }' });
    const slider = (f) => dp.locator(`#artist-form-score-${f}`);
    await slider('music_talent').scrollIntoViewIfNeeded();
    const grid = slider('music_talent').locator('xpath=ancestor::div[contains(@class,"grid")][1]');
    await dshot('s05a-rating-start', grid);
    for (const [f, v] of Object.entries(GROUP1)) { await slider(f).fill(String(v)); }
    await dshot('s05b-rating-group1', grid);
    for (const [f, v] of Object.entries(GROUP2)) { await slider(f).fill(String(v)); }
    await dshot('s05c-rating-group2', grid);
    await dp.locator('#artist-form-score-rationale').fill('Standout voice and songwriting; strong response to her originals.');
    await dp.getByRole('button', { name: 'Save changes' }).click();
    await dp.waitForLoadState('networkidle'); await dp.waitForTimeout(1500);
    await dp.reload({ waitUntil: 'networkidle' });
    await dshot('s04-rated-header', dp.locator('div.space-y-6 > div').first());
    await dshot('s04b-breakdown', dp.locator('div.space-y-6 > *').nth(1));
    await dshot('s04c-rated-page');
    const saved = JSON.parse(sql(`SELECT json_build_object('music_talent', music_talent, 'growth_velocity', growth_velocity, 'engagement_quality', engagement_quality, 'original_song_response', original_song_response, 'brand_personality', brand_personality, 'content_consistency', content_consistency, 'commercial_potential', commercial_potential, 'professionalism', professionalism, 'stage', stage) FROM artists WHERE id = ${juno};`));
    console.log('saved rating', saved);

    // ---- NEXT, phone, as Maya (who submitted Juno)
    const phone = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 }, deviceScaleFactor: 4, isMobile: true, hasTouch: true,
      storageState: await maya.storageState() });
    await phone.route(/img\.youtube\.com|i\.ytimg\.com/, (route) => route.fulfill({ path: path.join(COVERS, 'cover5.jpg'), contentType: 'image/jpeg' }));
    const page = await phone.newPage();
    const shot = async (name) => { await page.waitForTimeout(600); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); console.log('next', name); };
    // where each control sits on screen (fractions of the 390x844 viewport), so taps land on the real buttons
    const taps = {};
    const tap = async (name, loc) => { const b = await loc.boundingBox(); if (b) taps[name] = { u: (b.x + b.width / 2) / 390, v: (b.y + b.height / 2) / 844, w: b.width / 390, h: b.height / 844 }; };
    await page.goto('/next', { waitUntil: 'networkidle' }); await shot('n01-discover');
    await page.evaluate(() => document.getElementById('artists')?.scrollIntoView()); await shot('n02-discover-grid');
    const search = page.getByRole('searchbox', { name: 'Search artists' }).or(page.getByPlaceholder('Search artists…')).first();
    await search.scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollBy(0, -140));
    await tap('search', search);
    await search.click(); await search.pressSequentially('jun', { delay: 60 }); await shot('n02s-search');
    await search.fill('');
    await tap('filters', page.getByRole('button', { name: /^Filters/ }));
    await page.getByRole('button', { name: /^Filters/ }).click(); await shot('n02f-filters');
    await tap('card_in_filters', page.locator('#artists .next-card', { hasText: 'Juno Marrow' }).first());
    await page.getByRole('button', { name: /^Filters/ }).click();
    await page.goto(`/next/artists/${juno}`, { waitUntil: 'networkidle' }); await shot('n03-artist');
    await tap('play', page.getByRole('button', { name: /^Play video/ }).first());
    await tap('watch', page.getByRole('button', { name: /^Watch$/ }).first());
    await page.evaluate(() => window.scrollBy(0, 420)); await shot('n03b-artist-score');
    await page.evaluate(() => window.scrollTo(0, 0));
    const watch = page.getByRole('button', { name: /^Watch$/ }).first();
    await watch.click(); await page.waitForTimeout(800); await shot('n03w-watching');
    await page.goto(`/next/artists/${juno}`, { waitUntil: 'networkidle' });
    const tform = page.locator('form', { has: page.getByRole('button', { name: /Review purchase/ }) });
    await tform.scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollBy(0, -120)); await shot('n04a-trade-empty');
    await tap('balance', page.getByText(/^Balance/).first());
    await tap('amount', page.locator('#trade-panel-next-credits'));
    await tform.getByRole('button', { name: '$250', exact: false }).first().click().catch(async () => { await tform.locator('input').first().fill('250'); });
    await shot('n04-back-amount');
    await tap('review_buy', tform.getByRole('button', { name: /Review purchase/ }));
    await tform.getByRole('button', { name: /Review purchase/ }).click(); await shot('n05-confirm');
    await tap('confirm_buy', page.getByRole('button', { name: /Confirm purchase/ }));
    await page.getByRole('button', { name: /Confirm purchase/ }).click();
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(1200);
    await page.evaluate(() => window.scrollBy(0, -80)); await shot('n06-backed');
    const mayaBuy = JSON.parse(sql(`SELECT json_build_object('price', price_cents_per_share, 'shares', shares, 'credits', -credits_delta_cents) FROM next_transactions WHERE artist_id = ${juno} ORDER BY id LIMIT 1;`));
    // The crowd follows after Maya; each buy moves the price by the app's own rule.
    for (const [i, p] of players.slice(1).entries()) {
      const cash = Number(sql(`SELECT next_credits_cents FROM users WHERE email = 'player${i + 1}@example.com';`));
      const dollars = Math.min(1800, Math.floor(cash / 100) - 60);
      if (dollars > 100) await p.request.post(`/api/next/artists/${juno}/trade`, { data: { type: 'buy', credits_amount_cents: dollars * 100, idempotencyKey: `c${k++}` } });
    }
    await page.goto(`/next/artists/${juno}`, { waitUntil: 'networkidle' }); await shot('n07-artist-chart');
    // A small sell through the real Sell tab
    const sform = page.locator('form', { has: page.getByRole('button', { name: /Review/ }) }).first();
    await sform.scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollBy(0, -120));
    await tap('sell_tab', page.getByRole('button', { name: /^Sell$/ }).first());
    await page.getByRole('button', { name: /^Sell$/ }).first().click();
    await page.locator('#trade-panel-next-credits').fill('50'); await shot('n11a-sell-amount');
    await tap('review_sell', page.getByRole('button', { name: /Review/ }).first());
    await page.getByRole('button', { name: /Review/ }).first().click(); await shot('n11b-sell-confirm');
    await tap('confirm_sell', page.getByRole('button', { name: /Confirm/ }).first());
    await page.getByRole('button', { name: /Confirm/ }).first().click();
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(1200);
    await page.evaluate(() => window.scrollBy(0, -80)); await shot('n11c-sold');
    const mayaSell = JSON.parse(sql(`SELECT json_build_object('price', price_cents_per_share, 'shares', shares, 'credits', credits_delta_cents) FROM next_transactions WHERE artist_id = ${juno} AND user_id = (SELECT id FROM users WHERE email = 'player0@example.com') ORDER BY id DESC LIMIT 1;`));
    await page.goto('/next/portfolio', { waitUntil: 'networkidle' }); await shot('n08-portfolio');
    await page.goto('/next/leaderboard', { waitUntil: 'networkidle' }); await shot('n09-leaderboard');
    await page.evaluate(() => window.scrollBy(0, 330)); await shot('n09b-leaderboard-rows');
    await page.goto('/next/feed', { waitUntil: 'networkidle' }); await shot('n12-feed');
    await page.goto('/next/watchlist', { waitUntil: 'networkidle' }); await shot('n13-watchlist');
    await page.goto('/next/activity', { waitUntil: 'networkidle' }); await shot('n14-activity');
    await page.goto(`/next/artists/${juno}/founding-believer`, { waitUntil: 'networkidle' }); await shot('n10-founding-believer');
    const fb = JSON.parse(sql(`SELECT json_build_object('rank', f.discovery_rank, 'at', f.purchased_at) FROM next_founding_believers f JOIN users u ON u.id = f.user_id WHERE f.artist_id = ${juno} AND u.email = 'player0@example.com';`));
    const series = {};
    for (const [name, id] of Object.entries(ids)) {
      series[name] = sql(`SELECT string_agg(price_cents::text, ',' ORDER BY recorded_at, id) FROM next_price_history WHERE artist_id = ${id};`).split(',').filter(Boolean).map(Number);
    }
    const art = sql(`SELECT json_build_object('next_price', next_current_price_cents) FROM artists WHERE id = ${juno};`);
    fs.writeFileSync(path.join(OUT, 'series.json'), JSON.stringify(series));
    fs.writeFileSync(path.join(OUT, 'taps.json'), JSON.stringify(taps, null, 2));
    fs.writeFileSync(path.join(OUT, 'journey.json'), JSON.stringify({ juno_id: juno, ratings: { ...GROUP1, ...GROUP2 }, saved, maya_buy: mayaBuy, maya_sell: mayaSell,
      founding_believer: fb, artist: JSON.parse(art) }, null, 2));
    // Floating NEXT cards (desktop grid, 2x)
    const nd = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2, storageState: await maya.storageState() });
    await nd.route(/img\.youtube\.com|i\.ytimg\.com/, (route) => route.fulfill({ path: path.join(COVERS, 'cover5.jpg'), contentType: 'image/jpeg' }));
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
