// Run from the repo root with a production build (`npm run build`) and the
// local dev database (`npm run db:dev`). See e2e/README.md.
const { ROOT, DEV_DB } = require('./env');
const { spawn, execFileSync } = require('child_process');
const { chromium, request } = require('playwright');
const PORT = 3115, BASE = `http://localhost:${PORT}`, SHOTS = require('path').join(__dirname, 'screenshots');
const SCHEMA = `e2e_areq_${Date.now()}`;
const sql = (q) => execFileSync('psql', [DEV_DB, '-c', `SET search_path=${SCHEMA}; ${q}`], { encoding: 'utf8' });
const results = []; const check = (n, c, d = '') => { results.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
(async () => {
  const server = spawn('npx', ['next', 'start', '-p', String(PORT)], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: { ...process.env, DATABASE_URL: DEV_DB, DATABASE_SCHEMA: SCHEMA, ADMIN_EMAILS: 'founder@example.com', APP_URL: BASE, NODE_ENV: 'production' } });
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
    const browser = await chromium.launch(); const errors = [];
    const mk = async (name, email, vp = { width: 1280, height: 900 }) => {
      const ctx = await browser.newContext({ baseURL: BASE, viewport: vp });
      await ctx.request.post('/api/auth/signup', { data: { name, email, password: 'areq-pass-1234', tosAccepted: true, privacyAccepted: true } });
      await ctx.request.post('/api/next/onboarding/complete');
      const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(String(e)));
      return { ctx, page };
    };
    const staff = await mk('Founder', 'founder@example.com');
    const res = await staff.ctx.request.post('/api/artists', { data: { name: 'Nova Reyes', genre: 'Pop', bio: 'x', music_talent: 7, growth_velocity: 7, engagement_quality: 7, original_song_response: 7, brand_personality: 7, content_consistency: 7, commercial_potential: 7, professionalism: 7 } });
    const id = (await res.json()).id;
    const artistUser = await mk('Nova Real', 'nova@example.com');
    const fan = await mk('Fan Fiona', 'fiona@example.com', { width: 390, height: 844 });
    const uid = sql(`SELECT id FROM users WHERE email='nova@example.com';`).match(/\n\s*(\d+)\n/)[1];
    sql(`UPDATE artists SET claimed_by_user_id = ${uid} WHERE id = ${id};`);

    // A fan reports impersonation from the public artist page.
    await fan.page.goto(`${BASE}/next/artists/${id}`, { waitUntil: 'networkidle' });
    await fan.page.getByText('Report a problem with this profile').click();
    await fan.page.getByLabel('What is this about?').selectOption('impersonation');
    await fan.page.getByLabel('Details').fill('The Instagram link goes to a fan account, not the artist.');
    await fan.page.getByRole('button', { name: 'Send', exact: true }).click();
    await fan.page.getByText('a person at NEXT will review it').waitFor({ timeout: 10000 }).catch(() => {}); check('a signed-in visitor can report a profile problem', await fan.page.getByText('a person at NEXT will review it').isVisible());
    const guestPage = await (await browser.newContext({ baseURL: BASE })).newPage();
    await guestPage.goto(`${BASE}/next/artists/${id}`, { waitUntil: 'networkidle' });
    await guestPage.getByText('Report a problem with this profile').click();
    check('a signed-out visitor is asked to log in to report', await guestPage.getByRole('link', { name: 'Log in' }).last().isVisible());

    // The artist opens their dashboard.
    await artistUser.page.goto(`${BASE}/next/my-artist/${id}`, { waitUntil: 'networkidle' });
    let body = await artistUser.page.locator('body').innerText();
    check('dashboard shows 30-day profile analytics', /last 30 days/i.test(body) && body.includes('Preview plays') && body.includes('New backers'));
    check('dashboard no longer claims backers came "before anyone else"', !body.includes('before anyone else did'));
    await artistUser.page.getByLabel('What is this about?').selectOption('rating_review');
    await artistUser.page.getByLabel('Details').fill('New single out last week — could a Scout take another listen?');
    await artistUser.page.getByRole('button', { name: 'Send', exact: true }).click();
    await artistUser.page.getByText('a person at NEXT will review it').waitFor();
    await artistUser.page.reload({ waitUntil: 'networkidle' });
    check('the artist sees their request waiting', (await artistUser.page.locator('body').innerText()).includes('Waiting for review'));
    await artistUser.page.screenshot({ path: `${SHOTS}/artist-dashboard-requests.png`, fullPage: true });

    // Staff handle both.
    await staff.page.goto(`${BASE}/artist-requests`, { waitUntil: 'networkidle' });
    body = await staff.page.locator('body').innerText();
    check('staff queue lists both requests', /Waiting \(2\)/.test(body) && body.includes('Impersonation') && body.includes('Review my rating') && body.includes('from the verified artist'));
    check('Scout header shows the open count', /Requests\s*2/.test(body));
    const item = staff.page.locator('li.card', { hasText: 'Review my rating' });
    await item.getByLabel('Note to the requester (required)').fill('Re-listened: Music / Talent raised, Score updated.');
    await item.getByRole('button', { name: 'Resolve' }).click();
    await staff.page.waitForFunction(() => /Waiting \(1\)/.test(document.body.innerText));
    check('staff resolved a request', true);
    await artistUser.page.reload({ waitUntil: 'networkidle' });
    body = await artistUser.page.locator('body').innerText();
    check('the artist sees the outcome and note', body.includes('Done') && body.includes('Re-listened: Music / Talent raised'));

    const anon = await (await request.newContext({ baseURL: BASE })).post(`/api/next/artists/${id}/requests`, { data: { kind: 'correction', message: 'This should not be accepted at all.' } });
    check('reports need an account', anon.status() === 401);
    const notStaff = await fan.ctx.request.patch('/api/artist-requests/1', { data: { decision: 'resolved', note: 'x' } });
    check('only staff can resolve', notStaff.status() === 401);
    check('no client errors', errors.length === 0, errors.join(' | '));
    await browser.close();
  } catch (e) { check('ran', false, String(e.stack || e)); }
  finally { process.kill(-server.pid); console.log(`${results.filter(Boolean).length}/${results.length} passed`); }
})();
