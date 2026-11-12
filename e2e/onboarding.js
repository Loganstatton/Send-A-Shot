// Run from the repo root with a production build (`npm run build`) and the
// local dev database (`npm run db:dev`). See e2e/README.md.
const { ROOT, DEV_DB } = require('./env');
// First-run onboarding with genre picks, on the production build:
// sign up in the browser -> dialog (accessible) -> pick genres -> finish ->
// Discover opens on "For you" -> Settings shows the picks and can change
// them -> a second user skips with Escape and sees "All".
const { spawn } = require('child_process');
const { chromium, request } = require('playwright');

const PORT = 3105;
const BASE = `http://localhost:${PORT}`;
const SHOTS = require('path').join(__dirname, 'screenshots');
const results = [];
const check = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

async function signupInBrowser(page, name, email) {
  await page.goto(BASE + '/signup', { waitUntil: 'networkidle' });
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('onboard-pass-123');
  for (const cb of await page.locator('input[type="checkbox"]').all()) await cb.check();
  await page.getByRole('button', { name: /sign up|create account/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/signup'), { timeout: 15000 });
  if (!page.url().endsWith('/next')) await page.goto(BASE + '/next', { waitUntil: 'networkidle' });
}

(async () => {
  const server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
    cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: DEV_DB, DATABASE_SCHEMA: `e2e_onb_${Date.now()}`, ADMIN_EMAILS: 'founder@example.com', APP_URL: BASE, NODE_ENV: 'production' },
  });
  let log = ''; server.stdout.on('data', (d) => (log += d)); server.stderr.on('data', (d) => (log += d));
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
    const founder = await request.newContext({ baseURL: BASE });
    await founder.post('/api/auth/signup', { data: { name: 'Founder', email: 'founder@example.com', password: 'founder-pass-123', tosAccepted: true, privacyAccepted: true } });
    const seed = [['Nova Reyes', 'Pop'], ['Lumen', 'Pop/R&B'], ['Hollow Pines', 'Country'], ['Sable', 'Pop'], ['Grit Theory', 'Rock/Alternative'], ['Iron Vale', 'Rock/Alternative'], ['Ember Kid', 'Hip-Hop/Rap']];
    for (const [name, genre] of seed) {
      await founder.post('/api/artists', { data: { name, genre, bio: 'x', music_talent: 7, growth_velocity: 7, engagement_quality: 7, original_song_response: 7, brand_personality: 7, content_consistency: 7, commercial_potential: 7, professionalism: 7 } });
    }

    const browser = await chromium.launch();
    const errors = [];
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await signupInBrowser(page, 'Nia New', 'nia@example.com');

    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    check('onboarding is an accessible modal dialog', (await dialog.getAttribute('aria-modal')) === 'true' && (await dialog.getAttribute('aria-labelledby')) === 'onboarding-title');
    check('focus moves into the dialog', await page.evaluate(() => document.activeElement?.id === 'onboarding-title'));
    await dialog.getByRole('button', { name: 'Next' }).click();
    await dialog.getByText('What do you listen to?').waitFor();
    check('genre step comes second and offers defaults', (await dialog.getByRole('button', { name: 'Pop', exact: true }).count()) === 1 && (await dialog.getByRole('button', { name: 'Country', exact: true }).count()) === 1);
    check('with nothing picked, the button says "Skip this"', (await dialog.getByRole('button', { name: 'Skip this' }).count()) === 1);
    await dialog.getByRole('button', { name: 'Pop', exact: true }).click();
    await dialog.getByRole('button', { name: 'Country', exact: true }).click();
    check('picked genres are announced as pressed', (await dialog.getByRole('button', { name: '✓ Pop' }).getAttribute('aria-pressed')) === 'true');
    await page.screenshot({ path: `${SHOTS}/onboarding-genres-mobile.png` });
    await dialog.getByRole('button', { name: 'Next' }).click();
    const scoreText = await dialog.innerText();
    check('Score is described as a human rating, not live data', scoreText.includes("a person's judgement") && scoreText.includes("isn't a live streaming"));
    // Tab never leaves the dialog.
    for (let i = 0; i < 8; i++) await page.keyboard.press('Tab');
    check('keyboard focus stays inside the dialog', await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')));
    await dialog.getByRole('button', { name: 'Next' }).click();
    await dialog.getByRole('button', { name: 'Next' }).click();
    await dialog.getByRole('button', { name: 'Discover your first artist' }).click();
    await page.waitForURL(`${BASE}/next`);
    await page.waitForLoadState('networkidle');
    check('dialog closed after finishing', (await page.getByRole('dialog').count()) === 0);
    const forYou = page.getByRole('button', { name: 'For you' });
    check('Discover opens on "For you"', (await forYou.getAttribute('aria-pressed')) === 'true');
    const grid = await page.locator('#artists div.lg\\:grid-cols-3').innerText();
    check('"For you" shows Pop and Country artists only', ['Nova Reyes', 'Lumen', 'Hollow Pines', 'Sable'].every((n) => grid.includes(n)) && !grid.includes('Grit Theory') && !grid.includes('Ember Kid'));
    await page.getByRole('button', { name: 'All', exact: true }).click();
    check('"All" is one tap away and shows everyone', (await page.locator('#artists').innerText()).includes('Grit Theory'));
    await page.screenshot({ path: `${SHOTS}/discover-for-you-mobile.png` });

    await page.reload({ waitUntil: 'networkidle' });
    check('onboarding does not come back after finishing', (await page.getByRole('dialog').count()) === 0);

    await page.goto(BASE + '/settings', { waitUntil: 'networkidle' });
    check('Settings shows the picked genres', await page.getByLabel('Pop', { exact: true }).isChecked() && await page.getByLabel('Country', { exact: true }).isChecked() && !(await page.getByLabel('Latin', { exact: true }).isChecked()));
    await page.getByLabel('Country', { exact: true }).uncheck();
    await page.getByLabel('Rock/Alternative', { exact: true }).check();
    await page.getByRole('button', { name: 'Save genres' }).click();
    await page.getByText('Saved. Discover opens on these genres.').waitFor();
    await page.goto(BASE + '/next', { waitUntil: 'networkidle' });
    const grid2 = await page.locator('#artists div.lg\\:grid-cols-3').innerText();
    check('changing genres in Settings changes "For you"', grid2.includes('Grit Theory') && !grid2.includes('Hollow Pines'));

    // Second user: skip with Escape.
    const ctx2 = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
    const p2 = await ctx2.newPage();
    p2.on('pageerror', (e) => errors.push(String(e)));
    await signupInBrowser(p2, 'Sam Skipper', 'sam@example.com');
    await p2.getByRole('dialog').waitFor();
    await p2.keyboard.press('Escape');
    await p2.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    check('Escape skips onboarding', (await p2.getByRole('dialog').count()) === 0);
    await p2.reload({ waitUntil: 'networkidle' });
    check('skipped onboarding stays dismissed', (await p2.getByRole('dialog').count()) === 0);
    check('without picks there is no "For you" and Discover shows All', (await p2.getByRole('button', { name: 'For you' }).count()) === 0 && (await p2.getByRole('button', { name: 'All', exact: true }).getAttribute('aria-pressed')) === 'true');

    const bad = await ctx2.request.post('/api/next/genre-prefs', { data: { genres: 'Pop' } });
    check('genre API rejects a malformed body', bad.status() === 400);
    const anon = await (await request.newContext({ baseURL: BASE })).post('/api/next/genre-prefs', { data: { genres: ['Pop'] } });
    check('genre API needs an account', anon.status() === 401);

    check('no client-side errors', errors.length === 0, errors.join(' | '));
    await browser.close();
  } catch (err) {
    check('script ran to completion', false, String((err && err.stack) || err));
    console.log(log.slice(-2500));
  } finally {
    process.kill(-server.pid);
    const passed = results.filter(Boolean).length;
    console.log(`\n${passed}/${results.length} passed`);
    process.exit(passed === results.length ? 0 : 1);
  }
})();
