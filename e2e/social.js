// Run from the repo root with a production build (`npm run build`) and the
// local dev database (`npm run db:dev`). See e2e/README.md.
const { ROOT, DEV_DB } = require('./env');
const { spawn, execFileSync } = require('child_process');
const SCHEMA = `e2e_soc_${Date.now()}`;
const sql = (q) => execFileSync('psql', [DEV_DB, '-c', `SET search_path=${SCHEMA}; ${q}`], { encoding: 'utf8' });
const { chromium } = require('playwright');
const PORT = 3118, BASE = `http://localhost:${PORT}`;
const results = []; const check = (n, c, d = '') => { results.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
(async () => {
  const server = spawn('npx', ['next', 'start', '-p', String(PORT)], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: { ...process.env, DATABASE_URL: DEV_DB, DATABASE_SCHEMA: SCHEMA, ADMIN_EMAILS: 'founder@example.com', APP_URL: BASE, NODE_ENV: 'production' } });
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
    const browser = await chromium.launch(); const errors = [];
    const mk = async (name, email) => {
      const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
      await ctx.request.post('/api/auth/signup', { data: { name, email, password: 'social-pass-123', tosAccepted: true, privacyAccepted: true } });
      await ctx.request.post('/api/next/onboarding/complete');
      const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(String(e)));
      return { ctx, page };
    };
    const founder = await mk('Founder', 'founder@example.com');
    const ids = [];
    for (const name of ['Nova Reyes', 'Grit Theory']) {
      const r = await founder.ctx.request.post('/api/artists', { data: { name, genre: 'Pop', bio: 'x', music_talent: 7, growth_velocity: 7, engagement_quality: 7, original_song_response: 7, brand_personality: 7, content_consistency: 7, commercial_potential: 7, professionalism: 7 } });
      ids.push((await r.json()).id);
    }
    const me = await mk('Mia Member', 'mia@example.com');
    let k = 0;
    for (const id of ids) await me.ctx.request.post(`/api/next/artists/${id}/trade`, { data: { type: 'buy', credits_amount_cents: 20000, idempotencyKey: `s${k++}` } });

    const now = new Date().toISOString();
    for (const [i, id] of ids.entries()) for (const n of [1, 2]) sql(`INSERT INTO feed_events (event_type, artist_id, visibility, metadata, dedupe_key, created_at) VALUES ('new_artist', ${id}, 'public', NULL, 'seed-${i}-${n}', '${now}');`);
    // Settings: notification toggles actually save now.
    await me.page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
    await me.page.getByLabel(/Leaderboard rank changes/).uncheck();
    await me.page.getByLabel(/Weekly challenges/).uncheck();
    await me.page.getByRole('button', { name: 'Save notification preferences' }).click();
    await me.page.getByText('Saved.').waitFor();
    await me.page.reload({ waitUntil: 'networkidle' });
    check('notification preferences survive a reload (previously never saved)',
      !(await me.page.getByLabel(/Leaderboard rank changes/).isChecked()) && !(await me.page.getByLabel(/Weekly challenges/).isChecked()) && await me.page.getByLabel(/Leagues and artist updates/).isChecked());

    // Feed: hide one item, mute an artist.
    await me.page.goto(`${BASE}/next/feed`, { waitUntil: 'networkidle' });
    const cards = me.page.locator('.next-card', { has: me.page.getByRole('button', { name: 'Hide this from my Feed' }) });
    const before = await cards.count();
    check('feed shows items with Hide and Show less controls', before >= 2 && (await me.page.getByRole('button', { name: /Show less about/ }).count()) >= 1, `cards ${before}`);
    await me.page.getByRole('button', { name: 'Hide this from my Feed' }).first().click();
    await me.page.waitForFunction((n) => document.querySelectorAll('[aria-label="Hide this from my Feed"]').length === n - 1, before);
    await me.page.getByRole('button', { name: 'Show less about Grit Theory' }).first().click();
    await me.page.waitForTimeout(800);
    check('muting removes that artist from the feed now', (await me.page.getByRole('button', { name: 'Show less about Grit Theory' }).count()) === 0);
    await me.page.reload({ waitUntil: 'networkidle' });
    check('hidden and muted items stay gone after reload', (await me.page.getByRole('button', { name: 'Show less about Grit Theory' }).count()) === 0);
    await me.page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
    check('Settings lists the muted artist with an Unmute button', (await me.page.getByRole('button', { name: 'Unmute Grit Theory' }).count()) === 1);
    await me.page.getByRole('button', { name: 'Unmute Grit Theory' }).click();
    await me.page.waitForTimeout(500);
    await me.page.goto(`${BASE}/next/feed`, { waitUntil: 'networkidle' });
    check('unmuting brings the artist back', (await me.page.getByRole('button', { name: 'Show less about Grit Theory' }).count()) >= 1);

    // League: owner sees the join notification and recent picks.
    const lg = await founder.ctx.request.post('/api/next/leagues', { data: { name: 'Pickers' } });
    const { id: leagueId, inviteCode } = (await lg.json()).league;
    await me.ctx.request.post('/api/next/leagues/join', { data: { code: inviteCode } });
    const third = await founder.ctx.request.post('/api/artists', { data: { name: 'Hollow Pines', genre: 'Country', bio: 'x', music_talent: 7, growth_velocity: 7, engagement_quality: 7, original_song_response: 7, brand_personality: 7, content_consistency: 7, commercial_potential: 7, professionalism: 7 } });
    await me.ctx.request.post(`/api/next/artists/${(await third.json()).id}/trade`, { data: { type: 'buy', credits_amount_cents: 20000, idempotencyKey: 'after-join' } });
    await founder.page.goto(`${BASE}/next/leagues/${leagueId}`, { waitUntil: 'networkidle' });
    const lb = await founder.page.locator('body').innerText();
    check('league shows recent picks since joining only', /Mia Member backed Hollow Pines as backer #1/.test(lb) && !/backed Nova Reyes/.test(lb));
    await founder.page.goto(`${BASE}/next/notifications`, { waitUntil: 'networkidle' });
    check('the league owner is notified of the join', (await founder.page.locator('body').innerText()).includes('Mia Member joined your league Pickers'));
    check('no client errors', errors.length === 0, errors.join(' | '));
    await browser.close();
  } catch (e) { check('ran', false, String(e.stack || e)); }
  finally { process.kill(-server.pid); console.log(`${results.filter(Boolean).length}/${results.length} passed`); }
})();
