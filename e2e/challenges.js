// Run from the repo root with a production build (`npm run build`) and the
// local dev database (`npm run db:dev`). See e2e/README.md.
const { ROOT, DEV_DB } = require('./env');
// Weekly challenges + track record on the production build.
const { spawn } = require('child_process');
const { chromium, request } = require('playwright');
const PORT = 3110, BASE = `http://localhost:${PORT}`;
const SHOTS = require('path').join(__dirname, 'screenshots');
const results = [];
const check = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const signup = (ctx, name, email) => ctx.post('/api/auth/signup', { data: { name, email, password: 'chal-pass-1234', tosAccepted: true, privacyAccepted: true } });

(async () => {
  const server = spawn('npx', ['next', 'start', '-p', String(PORT)], { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: DEV_DB, DATABASE_SCHEMA: `e2e_chal_${Date.now()}`, ADMIN_EMAILS: 'founder@example.com', APP_URL: BASE, NODE_ENV: 'production' } });
  let log = ''; server.stdout.on('data', (d) => (log += d)); server.stderr.on('data', (d) => (log += d));
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
    const founder = await request.newContext({ baseURL: BASE });
    await signup(founder, 'Founder', 'founder@example.com');
    const ids = [];
    for (const [name, genre] of [['Nova Reyes', 'Pop'], ['Hollow Pines', 'Country'], ['Grit Theory', 'Rock/Alternative']]) {
      const r = await founder.post('/api/artists', { data: { name, genre, bio: 'x', music_talent: 7, growth_velocity: 7, engagement_quality: 7, original_song_response: 7, brand_personality: 7, content_consistency: 7, commercial_potential: 7, professionalism: 7 } });
      ids.push((await r.json()).id);
    }
    const browser = await chromium.launch();
    const errors = [];
    const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
    await signup(ctx.request, 'Cara Challenger', 'cara@example.com');
    await ctx.request.post('/api/next/onboarding/complete');
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(BASE + '/next', { waitUntil: 'networkidle' });
    let body = await page.locator('body').innerText();
    check('Discover shows the weekly challenges card', body.includes('Weekly challenges: 0 of 5 done'));
    const navOverflow = await page.evaluate(() => { const nav = document.querySelector('nav'); return nav ? nav.scrollWidth > nav.clientWidth + 1 || nav.getBoundingClientRect().right > window.innerWidth : null; });
    const header = await page.evaluate(() => { const h = document.querySelector('.next-theme > div'); return h ? h.scrollWidth <= window.innerWidth : null; });
    check('header fits at 1280px with the new links', navOverflow === false && header === true, `nav overflow ${navOverflow}, header fits ${header}`);
    await page.screenshot({ path: `${SHOTS}/challenges-discover-1280.png` });

    // Back an artist first (Early call + New sound), listen to 3 previews.
    const t = await ctx.request.post(`/api/next/artists/${ids[1]}/trade`, { data: { type: 'buy', credits_amount_cents: 20000, idempotencyKey: 'ch-1' } });
    check('first backing went through', t.status() === 200);
    for (const id of ids) {
      const r = await ctx.request.post('/api/next/preview-listen', { data: { artistId: id, event: 'started' } });
      if (r.status() !== 200 && r.status() !== 201) check('preview listen recorded', false, `status ${r.status()}`);
    }

    await page.goto(BASE + '/next/challenges', { waitUntil: 'networkidle' });
    body = await page.locator('body').innerText();
    check('challenges page shows 2 of 5 done', /This week\s*2 \/ 5/i.test(body), body.slice(0, 300).replace(/\n/g, ' | '));
    check('Early call and New sound are done', body.includes('Early call — done') || (await page.locator('li', { hasText: 'Early call' }).innerText()).includes('✓'));
    const listenBar = page.getByRole('progressbar', { name: 'Crate digger progress' });
    check('Crate digger shows 3/5 with an accessible progress bar', (await listenBar.getAttribute('aria-valuenow')) === '3' && (await listenBar.getAttribute('aria-valuemax')) === '5');
    check('streak is 0 with only 2 done', /Streak\s*0 weeks/i.test(body));
    await page.screenshot({ path: `${SHOTS}/challenges-page.png`, fullPage: true });

    // Two others back the same artist afterwards -> track record.
    for (const n of ['Dan', 'Eve']) {
      const c = await request.newContext({ baseURL: BASE });
      await signup(c, n, `${n.toLowerCase()}@example.com`);
      await c.post(`/api/next/artists/${ids[1]}/trade`, { data: { type: 'buy', credits_amount_cents: 500000, idempotencyKey: `ch-${n}` } });
    }
    const me = await (await ctx.request.get('/next/profile')).url();
    const guest = await browser.newContext({ baseURL: BASE });
    const gp = await guest.newPage();
    gp.on('pageerror', (e) => errors.push(String(e)));
    const profileUrl = page.url().replace('/next/challenges', '');
    await page.goto(BASE + '/next/profile', { waitUntil: 'networkidle' });
    const ownProfile = page.url();
    await gp.goto(ownProfile, { waitUntil: 'networkidle' });
    body = await gp.locator('body').innerText();
    { const i = body.toLowerCase().indexOf('track record'); console.log(JSON.stringify(body.slice(i, i + 400))); }
    check('public profile shows a track record to signed-out visitors', /Track record/i.test(body) && body.includes('1 of 1') && /2\s+people backed their picks afterwards/.test(body), ownProfile);
    check('track record is labelled as NEXT-only', body.includes("It isn't a measure of an artist's real-world success"));
    check('each pick shows its price change since backing', /\+\d+(\.\d)?% price since/.test(body));
    await gp.screenshot({ path: `${SHOTS}/profile-track-record.png`, fullPage: true });

    const anon = await (await request.newContext({ baseURL: BASE })).get('/next/challenges', { maxRedirects: 0 });
    check('challenges page needs an account (real redirect)', anon.status() === 307 && (anon.headers()['location'] || '').includes('/login'));
    await gp.goto(BASE + '/next/how-it-works', { waitUntil: 'networkidle' });
    check('How it works explains challenges and track record', (await gp.locator('#challenges').count()) === 1 && (await gp.locator('body').innerText()).includes('track record'));

    check('no client-side errors', errors.length === 0, errors.join(' | '));
    await browser.close();
  } catch (err) {
    check('script ran to completion', false, String((err && err.stack) || err));
    console.log(log.slice(-2000));
  } finally {
    process.kill(-server.pid);
    const passed = results.filter(Boolean).length;
    console.log(`\n${passed}/${results.length} passed`);
    process.exit(passed === results.length ? 0 : 1);
  }
})();
