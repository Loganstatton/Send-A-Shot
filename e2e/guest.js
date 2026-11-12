// Run from the repo root with a production build (`npm run build`) and the
// local dev database (`npm run db:dev`). See e2e/README.md.
const { ROOT, DEV_DB } = require('./env');
// Signed-out visitor journey on the production build + local Postgres:
// landing -> browse -> artist page -> sign up from the artist page -> lands
// back on the artist -> backs it -> shares the proof link -> a stranger
// opens the proof link (no account) and sees it, with preview metadata.
const { spawn } = require('child_process');
const { chromium, request } = require('playwright');

const PORT = 3101;
const BASE = `http://localhost:${PORT}`;
const SHOTS = require('path').join(__dirname, 'screenshots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

(async () => {
  const server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
    cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: (process.env.E2E_DATABASE_URL || DEV_DB), ADMIN_EMAILS: 'founder@example.com', APP_URL: BASE, NODE_ENV: 'production' },
  });
  let log = ''; server.stdout.on('data', (d) => (log += d)); server.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }

  const browser = await chromium.launch();
  const errors = [];
  const guestCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await guestCtx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));

  // Empty market first.
  let resp = await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  check('signed-out visitor at / lands on NEXT, not a login form', page.url() === `${BASE}/next`, page.url());
  let body = await page.locator('body').innerText();
  check('empty market shows a useful empty state, not zeros', body.includes('The first artists are on their way') && !/Total backers\s*0/.test(body));
  check('pitch headline shown', body.includes("Discover tomorrow's biggest artists"));
  await page.screenshot({ path: `${SHOTS}/guest-empty-mobile.png`, fullPage: true });

  // Admin adds artists.
  const founder = await request.newContext({ baseURL: BASE });
  await founder.post('/api/auth/signup', { data: { name: 'Founder', email: 'founder@example.com', password: 'founder-pass-123', tosAccepted: true, privacyAccepted: true } });
  const ids = [];
  for (const [name, genre, r] of [['Nova Reyes', 'Pop', 8], ['Kairo Blue', 'Hip-Hop/Rap', 6], ['The Lanterns', 'Rock/Alternative', 7]]) {
    const res = await founder.post('/api/artists', { data: { name, genre, location: 'Austin, TX', bio: `${name} makes music.`, music_talent: r, growth_velocity: r, engagement_quality: r, original_song_response: r, brand_personality: r, content_consistency: r, commercial_potential: r, professionalism: r } });
    ids.push((await res.json()).id);
  }

  await page.goto(BASE + '/next', { waitUntil: 'networkidle' });
  body = await page.locator('body').innerText();
  check('guest sees artists, how-it-works, and the virtual-credits disclosure', body.includes('Nova Reyes') && /how it works/i.test(body) && body.includes("can't be bought or cashed out"));
  check('no empty market stats shown on a quiet market', !body.includes('Total backers'));
  await page.screenshot({ path: `${SHOTS}/guest-discover-mobile.png`, fullPage: false });

  resp = await page.goto(`${BASE}/next/artists/${ids[0]}`, { waitUntil: 'networkidle' });
  body = await page.locator('body').innerText();
  check('guest can open an artist page', resp.status() === 200 && body.includes('Nova Reyes'));
  check('artist page offers sign-up instead of a trade form', body.includes('Sign up to back Nova Reyes'));
  check('no "undervalued" wording anywhere on the artist page', !/undervalued|overheated|fair value/i.test(body));
  const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
  check('artist page has share-preview metadata', ogTitle === 'Nova Reyes on NEXT', ogTitle);
  await page.screenshot({ path: `${SHOTS}/guest-artist-mobile.png`, fullPage: true });

  resp = await page.goto(`${BASE}/next/leaderboard`, { waitUntil: 'networkidle' });
  check('guest can open the leaderboard', resp.status() === 200);
  await page.goto(`${BASE}/next/portfolio`, { waitUntil: 'networkidle' });
  check('a personal page sends the guest to log in, remembering where they were', page.url().startsWith(`${BASE}/login?next=%2Fnext%2Fportfolio`), page.url());

  // Watch button for a guest goes to signup.
  await page.goto(`${BASE}/next/artists/${ids[0]}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Watch' }).first().click();
  await page.waitForURL(/\/signup/);
  check('guest pressing Watch is sent to sign up for this artist', page.url().includes(`next=${encodeURIComponent(`/next/artists/${ids[0]}`)}`), page.url());

  // Sign up from there; should land back on the artist page.
  await page.getByLabel('Name').fill('Guest Turned Fan');
  await page.getByLabel('Email').fill('guestfan@example.com');
  await page.getByLabel('Password').fill('guestfan-pass-1');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Sign up' }).click();
  await page.waitForURL(`${BASE}/next/artists/${ids[0]}`, { timeout: 15000 }).catch(() => {});
  check('after signing up the visitor lands back on the artist they were looking at', page.url() === `${BASE}/next/artists/${ids[0]}`, page.url());

  // Back the artist via the API with the browser's session.
  const fanApi = await request.newContext({ baseURL: BASE, storageState: await guestCtx.storageState() });
  const trade = await fanApi.post(`/api/next/artists/${ids[0]}/trade`, { data: { type: 'buy', credits_amount_cents: 50000, idempotencyKey: 'guest-e2e-1' } });
  check('new fan backs the artist', trade.status() === 200);

  await page.goto(`${BASE}/next/artists/${ids[0]}/founding-believer`, { waitUntil: 'networkidle' });
  body = await page.locator('body').innerText();
  check('own receipt page offers a public proof link', body.includes('Share proof link'));

  const proofLinks = (await (await request.newContext({ baseURL: BASE })).get(`/next/profile/${(await (await fanApi.patch('/api/account', { data: {} })).json()).id}`)).text();
  const proofId = Number((await proofLinks).match(/\/next\/proof\/(\d+)/)?.[1]);
  check('a stranger viewing the fan\'s public profile gets proof links', Number.isInteger(proofId), String(proofId));

  // A stranger with no account opens the proof link.
  const stranger = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  stranger.on('pageerror', (e) => errors.push(String(e)));
  resp = await stranger.goto(`${BASE}/next/proof/${proofId}`, { waitUntil: 'networkidle' });
  body = await stranger.locator('body').innerText();
  check('stranger (signed out) can open the proof page', resp.status() === 200 && body.includes('Guest Turned Fan') && body.includes('#1') && body.includes('Nova Reyes'));
  check('proof page invites the stranger to sign up', body.includes("Start scouting — it's free"));
  const ogImage = await stranger.locator('meta[property="og:image"]').getAttribute('content');
  check('proof page preview image is an absolute URL to the card', ogImage === `${BASE}/api/next/proof/${proofId}/card`, ogImage);
  const card = await fetch(ogImage);
  check('preview card renders as a PNG for anyone', card.status === 200 && card.headers.get('content-type') === 'image/png', `${card.status} ${card.headers.get('content-type')}`);
  await stranger.screenshot({ path: `${SHOTS}/proof-desktop.png`, fullPage: true });
  require('fs').writeFileSync(`${SHOTS}/proof-card.png`, Buffer.from(await card.arrayBuffer()));
  resp = await stranger.goto(`${BASE}/next/proof/999999`, { waitUntil: 'networkidle' });
  check('unknown proof id shows the not-found page', (await stranger.locator('body').innerText()).includes('Page not found'));

  // Return-path open-redirect attempt.
  const evil = await request.newContext({ baseURL: BASE });
  const loginPage = await (await evil.get('/login?next=https%3A%2F%2Fevil.example')).text();
  check('login ignores an off-site return path', loginPage.includes('returnTo\\":\\"/\\"'));

  check('no uncaught browser errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  const serverErrors = log.split('\n').filter((l) => /error/i.test(l) && !/verification email|email not configured/i.test(l));
  check('no errors in server log', serverErrors.length === 0, serverErrors.slice(0, 2).join(' | ').slice(0, 300));

  await browser.close();
  try { process.kill(-server.pid, 'SIGKILL'); } catch {}
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
