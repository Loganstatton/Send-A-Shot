// Run from the repo root with a production build (`npm run build`) and the
// local dev database (`npm run db:dev`). See e2e/README.md.
const { ROOT, DEV_DB } = require('./env');
// Private leagues, end to end on the production build + local Postgres:
// owner creates a league in the browser -> shares invite link -> a guest
// opens it, signs up from it, lands back on it, joins -> both trade ->
// standings rank by return since joining -> non-member can't see it ->
// owner resets link (old link dead) and removes a member -> leave.
const { spawn } = require('child_process');
const { chromium, request } = require('playwright');

const PORT = 3104;
const BASE = `http://localhost:${PORT}`;
const SHOTS = require('path').join(__dirname, 'screenshots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const signup = (ctx, name, email) => ctx.post('/api/auth/signup', { data: { name, email, password: 'league-pass-123', tosAccepted: true, privacyAccepted: true } });

(async () => {
  const server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
    cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: DEV_DB, DATABASE_SCHEMA: `e2e_leagues_${Date.now()}`, ADMIN_EMAILS: 'founder@example.com', APP_URL: BASE, NODE_ENV: 'production' },
  });
  let log = ''; server.stdout.on('data', (d) => (log += d)); server.stderr.on('data', (d) => (log += d));
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }

    const founder = await request.newContext({ baseURL: BASE });
    await signup(founder, 'Founder', 'founder@example.com');
    const art = await founder.post('/api/artists', { data: { name: 'Nova Reyes', genre: 'Pop', location: 'Austin, TX', bio: 'Pop.', music_talent: 8, growth_velocity: 8, engagement_quality: 8, original_song_response: 8, brand_personality: 8, content_consistency: 8, commercial_potential: 8, professionalism: 8 } });
    const artistId = (await art.json()).id;
    check('admin created an artist', Number.isInteger(artistId));

    const browser = await chromium.launch();
    const errors = [];

    // Owner, in a real browser.
    const ownerCtx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
    await signup(ownerCtx.request, 'Olivia Owner', 'owner@example.com');
    await ownerCtx.request.post('/api/next/onboarding/complete');
    const op = await ownerCtx.newPage();
    op.on('pageerror', (e) => errors.push(String(e)));
    await op.goto(BASE + '/next/leagues', { waitUntil: 'networkidle' });
    let body = await op.locator('body').innerText();
    check('leagues page shows empty state and both forms', body.includes("You're not in a league yet") && body.includes('Start a league') && body.includes('Join with a code'));
    check('Leagues is in the main nav', (await op.locator('nav a[href="/next/leagues"]').count()) > 0);
    await op.getByLabel('Start a league').fill('Group Chat Diggers');
    await op.getByRole('button', { name: 'Create league' }).click();
    await op.waitForURL(/\/next\/leagues\/\d+$/);
    const leagueUrl = op.url();
    const leagueId = Number(leagueUrl.split('/').pop());
    body = await op.locator('body').innerText();
    check('created league page shows name, owner standing and invite code', body.includes('Group Chat Diggers') && body.includes('Olivia Owner (you)') && /Invite code\s+[A-Z2-9]{8}/i.test(body));
    const code = body.match(/Invite code\s+([A-Z2-9]{8})/i)[1];
    await op.screenshot({ path: `${SHOTS}/league-owner.png`, fullPage: true });

    // A guest opens the invite link on a phone.
    const guestCtx = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const gp = await guestCtx.newPage();
    gp.on('pageerror', (e) => errors.push(String(e)));
    let resp = await gp.goto(`${BASE}/next/leagues/join/${code.toLowerCase()}`, { waitUntil: 'networkidle' });
    body = await gp.locator('body').innerText();
    check('guest can open the invite (any case)', resp.status() === 200 && body.includes('Group Chat Diggers') && body.includes('Run by Olivia Owner') && body.includes('1 member'));
    const ogTitle = await gp.locator('meta[property="og:title"]').getAttribute('content');
    check('invite link previews with the league name', ogTitle === 'Join Group Chat Diggers on NEXT', ogTitle);
    check('invite page is noindex', ((await gp.locator('meta[name="robots"]').getAttribute('content')) || '').includes('noindex'));
    await gp.screenshot({ path: `${SHOTS}/league-invite-guest.png`, fullPage: true });
    await gp.getByRole('link', { name: 'Sign up free to join' }).click();
    await gp.waitForURL(/\/signup/);
    await gp.getByLabel('Name').fill('Gabe Guest');
    await gp.getByLabel('Email').fill('guest@example.com');
    await gp.getByLabel('Password').fill('league-pass-123');
    for (const cb of await gp.locator('input[type="checkbox"]').all()) await cb.check();
    await gp.getByRole('button', { name: /sign up|create account/i }).click();
    await gp.waitForURL(/\/next\/leagues\/join\//, { timeout: 15000 }).catch(() => {});
    check('after signing up the guest lands back on the invite', gp.url().includes(`/next/leagues/join/${code}`), gp.url());
    await guestCtx.request.post('/api/next/onboarding/complete');
    await gp.reload({ waitUntil: 'networkidle' });
    await gp.getByRole('button', { name: 'Join Group Chat Diggers' }).click();
    await gp.waitForURL(/\/next\/leagues\/\d+$/);
    body = await gp.locator('body').innerText();
    check('guest joined and sees standings with both members', body.includes('2 members') && body.includes('Olivia Owner') && body.includes('Gabe Guest (you)'));
    check('non-owner sees no owner controls', (await gp.getByRole('button', { name: 'Reset link' }).count()) === 0 && (await gp.getByRole('button', { name: /^Remove/ }).count()) === 0);

    // Both back the artist; the guest's buy lifts the owner's position.
    const t1 = await ownerCtx.request.post(`/api/next/artists/${artistId}/trade`, { data: { type: 'buy', credits_amount_cents: 300000, idempotencyKey: 'lg-1' } });
    const t2 = await guestCtx.request.post(`/api/next/artists/${artistId}/trade`, { data: { type: 'buy', credits_amount_cents: 800000, idempotencyKey: 'lg-2' } });
    check('both trades went through', t1.status() === 200 && t2.status() === 200);
    await op.goto(leagueUrl, { waitUntil: 'networkidle' });
    const rows = await op.locator('ol li').allInnerTexts();
    check('owner ranks #1 with a positive return after the guest pushed the price', rows[0].includes('#1') && rows[0].includes('Olivia Owner') && /\+\d+(\.\d)?%/.test(rows[0]), rows[0].replace(/\n/g, ' | '));
    await op.screenshot({ path: `${SHOTS}/league-standings.png`, fullPage: true });

    // A stranger can't see the league by id.
    const stranger = await request.newContext({ baseURL: BASE });
    await signup(stranger, 'Sam Stranger', 'stranger@example.com');
    resp = await stranger.get(`/next/leagues/${leagueId}`);
    const strangerHtml = await resp.text();
    check("a non-member can't see the league's standings", !strangerHtml.includes('Group Chat Diggers') && !strangerHtml.includes('Gabe Guest'));
    const guestLeagueResp = await (await request.newContext({ baseURL: BASE })).get(`/next/leagues/${leagueId}`, { maxRedirects: 0 });
    check('signed-out request for a league goes to login', [307, 302, 303].includes(guestLeagueResp.status()) && (guestLeagueResp.headers()['location'] || '').includes('/login'));

    // Owner resets the link: the old code stops working.
    op.once('dialog', (d) => d.accept());
    await op.getByRole('button', { name: 'Reset link' }).click();
    await op.getByText('New invite link ready').waitFor();
    const oldJoin = await stranger.post('/api/next/leagues/join', { data: { code } });
    check('old invite code no longer works after reset', oldJoin.status() === 404);

    // Owner removes the guest.
    op.once('dialog', (d) => d.accept());
    await op.getByRole('button', { name: 'Remove Gabe Guest' }).click();
    await op.waitForFunction(() => !document.body.innerText.includes('Gabe Guest'));
    check('owner removed a member', !(await op.locator('body').innerText()).includes('Gabe Guest'));
    const gone = await guestCtx.request.get(`/next/leagues/${leagueId}`);
    check('removed member can no longer see the league', !(await gone.text()).includes('Group Chat Diggers'));

    // API guards.
    const anonCreate = await (await request.newContext({ baseURL: BASE })).post('/api/next/leagues', { data: { name: 'Nope' } });
    check('creating a league requires an account', anonCreate.status() === 401);
    const badName = await stranger.post('/api/next/leagues', { data: { name: 'x' } });
    check('too-short league names are rejected', badName.status() === 400);
    const notOwnerReset = await stranger.post(`/api/next/leagues/${leagueId}/invite-code`);
    check('non-owner cannot reset the invite code', notOwnerReset.status() === 403);

    // Owner leaves as the last member: league deleted.
    op.once('dialog', (d) => d.accept());
    await op.getByRole('button', { name: 'Leave league' }).click();
    await op.waitForURL(/\/next\/leagues$/);
    check('last member leaving deletes the league', (await op.locator('body').innerText()).includes("You're not in a league yet"));

    // Leaderboard links to leagues.
    await op.goto(BASE + '/next/leaderboard', { waitUntil: 'networkidle' });
    check('leaderboard points to private leagues', (await op.locator('a[href="/next/leagues"]').count()) >= 2);

    check('no client-side errors', errors.length === 0, errors.join(' | '));
    await browser.close();
  } catch (err) {
    check('script ran to completion', false, String(err && err.stack || err));
    console.log(log.slice(-3000));
  } finally {
    process.kill(-server.pid);
    const passed = results.filter(Boolean).length;
    console.log(`\n${passed}/${results.length} passed`);
    process.exit(passed === results.length ? 0 : 1);
  }
})();
