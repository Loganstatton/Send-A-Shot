// Run from the repo root with a production build (`npm run build`) and the
// local dev database (`npm run db:dev`). See e2e/README.md.
const { ROOT, DEV_DB } = require('./env');
// End-to-end check of the real production build against a real Postgres:
// sign up, list artists, trade, back up, RESTART THE SERVER, and confirm
// sessions and data survive. Run from the repo root after `next build`.
const { spawn } = require('child_process');
const zlib = require('zlib');
const { chromium, request } = require('playwright');

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
const DB = (process.env.E2E_DATABASE_URL || DEV_DB);
const SHOTS = require('path').join(__dirname, 'screenshots');
require('fs').mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

let server;
async function startServer() {
  server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: DB, ADMIN_EMAILS: 'founder@example.com', SESSION_SECRET: '', NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  server.getLog = () => log;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server did not start:\n' + log);
}
async function stopServer() {
  try { process.kill(-server.pid, 'SIGKILL'); } catch {}
  await new Promise((r) => setTimeout(r, 1000));
}

(async () => {
  await startServer();
  const health = await (await fetch(`${BASE}/api/health`)).json();
  check('health endpoint reports database connected', health.ok && health.db === 'connected');

  const founder = await request.newContext({ baseURL: BASE });
  const fan = await request.newContext({ baseURL: BASE });
  const signup = (ctx, name, email) => ctx.post('/api/auth/signup', { data: { name, email, password: 'correct-horse-9', tosAccepted: true, privacyAccepted: true } });

  let r = await signup(founder, 'Founder', 'founder@example.com');
  check('founder signs up', r.status() === 201, `status ${r.status()}`);
  r = await signup(fan, 'First Fan', 'fan@example.com');
  check('fan signs up', r.status() === 201);
  const fanUser = await r.json();
  check('new account starts with 10,000 credits', fanUser.next_credits_cents === 1_000_000);
  r = await signup(await request.newContext({ baseURL: BASE }), 'Dup', 'FAN@example.com');
  check('duplicate email (different case) is refused', r.status() === 409, `status ${r.status()}`);

  // Simultaneous duplicate signups: exactly one wins, none 500.
  const racers = await Promise.all(Array.from({ length: 6 }, async () => signup(await request.newContext({ baseURL: BASE }), 'Racer', 'racer@example.com')));
  const codes = racers.map((x) => x.status()).sort();
  check('six simultaneous signups for one email: exactly one account, no server errors', codes.filter((c) => c === 201).length === 1 && codes.every((c) => c === 201 || c === 409), codes.join(','));

  // Founder is bootstrapped to admin via ADMIN_EMAILS and can add artists.
  const artists = [];
  for (const [name, genre, rating] of [['Nova Reyes', 'Pop', 8], ['Kairo Blue', 'Hip-Hop/Rap', 6], ['The Lanterns', 'Rock/Alternative', 7]]) {
    r = await founder.post('/api/artists', { data: {
      name, genre, location: 'Austin, TX', followers_count: '12,5'.length ? 12500 : 0, monthly_listeners: 8300.4,
      music_talent: rating, growth_velocity: rating, engagement_quality: rating, original_song_response: rating,
      brand_personality: rating, content_consistency: rating, commercial_potential: rating, professionalism: rating,
    } });
    check(`founder (admin) adds artist ${name}`, r.status() === 201 || r.status() === 200, `status ${r.status()}`);
    artists.push(await r.json());
  }
  r = await fan.post('/api/artists', { data: { name: 'Hacker Artist' } });
  check('a public user cannot add artists', r.status() === 401, `status ${r.status()}`);
  r = await founder.post('/api/artists', { data: { name: 'Messy Input', music_talent: 99, followers_count: 'lots', monthly_listeners: '' } });
  const messy = await r.json();
  check('out-of-range and non-numeric artist input is normalized, not a server error', r.ok() && messy.music_talent === 10 && messy.followers_count === null, `status ${r.status()} talent=${messy.music_talent} followers=${messy.followers_count}`);

  await fan.post('/api/next/onboarding/complete');

  // Trading through the real route.
  const artistId = artists[0].id;
  const trade = (ctx, body) => ctx.post(`/api/next/artists/${artistId}/trade`, { data: body });
  r = await trade(fan, { type: 'buy', credits_amount_cents: 250_000, idempotencyKey: 'e2e-buy-1' });
  const buy = await r.json();
  check('fan buys $2,500 of an artist', r.status() === 200 && buy.ok && buy.newBalanceCents === 750_000, JSON.stringify(buy));
  r = await trade(fan, { type: 'buy', credits_amount_cents: 250_000, idempotencyKey: 'e2e-buy-1' });
  const replay = await r.json();
  check('resending the same request does not trade twice', r.status() === 200 && JSON.stringify(replay) === JSON.stringify(buy));
  const burst = await Promise.all(Array.from({ length: 8 }, () => trade(fan, { type: 'buy', credits_amount_cents: 400_000, idempotencyKey: `e2e-burst-${Math.random()}` })));
  const okCount = (await Promise.all(burst.map((b) => b.json()))).filter((b) => b.ok).length;
  check('eight simultaneous $4,000 buys against a $7,500 balance: exactly one succeeds', okCount === 1, `succeeded: ${okCount}`);
  r = await trade(fan, { type: 'buy', credits_amount_cents: -5 });
  check('negative amount rejected', r.status() === 400);
  r = await trade(fan, { type: 'buy', credits_amount_cents: 'abc' });
  check('non-numeric amount rejected', r.status() === 400);
  r = await fan.post(`/api/next/artists/${artistId}/trade`, { headers: { 'content-type': 'application/json' }, data: '{not json' });
  check('malformed body rejected with 400, not 500', r.status() === 400, `status ${r.status()}`);
  r = await (await request.newContext({ baseURL: BASE })).post(`/api/next/artists/${artistId}/trade`, { data: { type: 'buy', credits_amount_cents: 1000 } });
  check('trading without a session is refused', r.status() === 401);
  r = await trade(fan, { type: 'sell', credits_amount_cents: 100_000, idempotencyKey: 'e2e-sell-1' });
  const sell = await r.json();
  check('fan sells part of the position', r.status() === 200 && sell.ok, JSON.stringify(sell));
  const balanceBeforeRestart = sell.newBalanceCents;

  // Admin backup: take, list, download, verify contents.
  r = await founder.post('/api/admin/backup');
  const backup = await r.json();
  check('admin takes a snapshot', r.ok() && backup.rowCount > 0, JSON.stringify(backup));
  r = await founder.get(`/api/admin/backup/${backup.fileName}`);
  const snap = JSON.parse(zlib.gunzipSync(await r.body()).toString());
  check('downloaded snapshot contains the users and the trades', snap.tables.users.length >= 3 && snap.tables.next_transactions.length >= 3, `users=${snap.tables.users.length} tx=${snap.tables.next_transactions.length}`);
  r = await fan.get(`/api/admin/backup/${backup.fileName}`);
  check('a public user cannot download a snapshot', r.status() === 401);
  r = await fan.post(`/api/admin/backup/${backup.fileName}/restore`, { data: { confirm: backup.fileName } });
  check('a public user cannot restore', r.status() === 401);
  r = await founder.post(`/api/admin/backup/${backup.fileName}/restore`, { data: { confirm: 'wrong' } });
  check('restore without the exact confirmation is refused', r.status() === 400);

  // Pages render for real in a browser (signed in as the fan).
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ storageState: await fan.storageState(), viewport: { width: 1280, height: 900 } })).newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  async function visit(path, expectText, shot) {
    const resp = await page.goto(BASE + path, { waitUntil: 'networkidle' });
    const body = await page.locator('body').innerText();
    const broke = /Something went wrong|Application error|Internal Server Error/i.test(body);
    check(`page ${path} renders`, resp.status() === 200 && !broke && (!expectText || body.includes(expectText)), `status ${resp.status()}${expectText && !body.includes(expectText) ? `, missing "${expectText}"` : ''}`);
    if (shot) await page.screenshot({ path: `${SHOTS}/${shot}.png`, fullPage: false });
    return body;
  }
  await visit('/next', 'Nova Reyes', 'discover');
  const artistBody = await visit(`/next/artists/${artistId}`, 'Nova Reyes', 'artist');
  const portfolioBody = await visit('/next/portfolio', 'Nova Reyes', 'portfolio');
  await visit('/next/leaderboard', 'First Fan', 'leaderboard');
  await visit('/next/feed', null, 'feed');
  await visit('/next/watchlist');
  await visit('/next/activity', 'First Fan');
  await visit('/next/notifications');
  await visit(`/next/profile/${fanUser.id}`, 'First Fan');
  await visit('/settings');
  const adminPage = await (await browser.newContext({ storageState: await founder.storageState(), viewport: { width: 1280, height: 900 } })).newPage();
  for (const path of ['/', '/screener', '/metrics', '/discovery', '/admin/users', '/admin/backups', '/admin/market-integrity', '/admin/sync', '/admin/errors', '/admin/scout-accuracy', `/artists/${artistId}`]) {
    const resp = await adminPage.goto(BASE + path, { waitUntil: 'networkidle' });
    const body = await adminPage.locator('body').innerText();
    check(`admin page ${path} renders`, resp.status() === 200 && !/Something went wrong|Application error/i.test(body), `status ${resp.status()}`);
    if (path === '/admin/backups') await adminPage.screenshot({ path: `${SHOTS}/admin-backups.png` });
  }

  // THE POINT OF ALL THIS: kill the server process and start a new one.
  await stopServer();
  await startServer();
  r = await fan.patch('/api/account', { data: { name: 'First Fan' } });
  const afterRestart = await r.json();
  check('after a server restart the fan is STILL signed in (session survives)', r.status() === 200, `status ${r.status()}`);
  check('after a server restart the balance is exactly what it was', afterRestart.next_credits_cents === balanceBeforeRestart, `${afterRestart.next_credits_cents} vs ${balanceBeforeRestart}`);
  const fresh = await request.newContext({ baseURL: BASE });
  r = await fresh.post('/api/auth/login', { data: { email: 'fan@example.com', password: 'correct-horse-9' } });
  check('after a server restart, logging in with the password works', r.status() === 200);
  r = await fresh.post('/api/auth/login', { data: { email: 'fan@example.com', password: 'wrong-password' } });
  check('wrong password is refused', r.status() === 401);
  const body2 = await (await page.goto(BASE + '/next/portfolio', { waitUntil: 'networkidle' })).text();
  check('after a server restart the portfolio still shows the holding', body2.includes('Nova Reyes'));

  // Restore: wreck something, restore the snapshot, confirm it's back.
  r = await founder.delete(`/api/artists/${artistId}`);
  check('admin deletes the traded artist (simulated accident)', r.ok(), `status ${r.status()}`);
  r = await founder.post(`/api/admin/backup/${backup.fileName}/restore`, { data: { confirm: backup.fileName } });
  const restored = await r.json();
  check('admin restores the snapshot', r.ok() && restored.rowCount === backup.rowCount, JSON.stringify(restored).slice(0, 160));
  const body3 = await (await page.goto(BASE + '/next/portfolio', { waitUntil: 'networkidle' })).text();
  check('after the restore the deleted artist and the holding are back', body3.includes('Nova Reyes'));

  check('no uncaught browser errors on any page', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  const serverErrors = server.getLog().split('\n').filter((l) => /error/i.test(l) && !/verification email|email not configured/i.test(l));
  check('no errors in the server log', serverErrors.length === 0, serverErrors.slice(0, 3).join(' | ').slice(0, 300));

  await browser.close();
  await stopServer();
  const failed = results.filter((x) => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(async (err) => {
  console.error('E2E crashed:', err);
  if (server) console.error(server.getLog().slice(-2000));
  await stopServer();
  process.exit(2);
});
