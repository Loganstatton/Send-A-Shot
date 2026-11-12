// Run from the repo root with a production build (`npm run build`) and the
// local dev database (`npm run db:dev`). See e2e/README.md.
//
// Dead-end sweep: as a signed-out visitor, a player, a claimed artist and an
// admin — on desktop, and for key pages on a phone — visit every reachable
// page and
//   - follow every internal link: it must not lead to "Page not found" or an
//     error page;
//   - check every in-page "#anchor" link points at something that exists;
//   - click every button (on a fresh load of the page) and require that it
//     DOES something: navigates, sends a request, changes the page, opens a
//     dialog, or (for a submit button) is stopped by the form's validation.
// Destructive buttons (delete, log out, restore, leave…) are listed, not clicked.
const { ROOT, DEV_DB } = require('./env');
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('playwright');

const PORT = 3121, BASE = `http://localhost:${PORT}`;
const SCHEMA = `e2e_dead_${Date.now()}`;
const sql = (q) => execFileSync('psql', [DEV_DB, '-At', '-c', `SET search_path=${SCHEMA}; ${q}`], { encoding: 'utf8' }).trim().split('\n').pop();
const DESTRUCTIVE = /delete|remove|leave league|restore|log ?out|sign out|reset link|unpublish|reject|resolve|remove from next|log out of all|unmute|^sell|sell all|demote|cancel/i;
const PER_PATTERN = 2; // visit at most this many pages per route shape (e.g. /next/artists/:id)
const problems = [];
const skipped = new Set();
const tested = new Set(); // role + route shape + button name, so "Watch" isn't re-tested on every artist page
const report = (kind, where, what) => problems.push({ kind, where, what });

function pattern(path) {
  return path.split('?')[0].replace(/\/\d+(?=\/|$)/g, '/:id').replace(/\/join\/[A-Z0-9]+$/, '/join/:code').replace(/\/(proof|collections|genres)\/[^/]+$/, '/$1/:x');
}

// Some sessions use a timezone and locale unlike the server's, so a page that
// formats a date or number differently in the browser than on the server
// shows up as a hydration error.
const FAR_AWAY = { timezoneId: 'Pacific/Auckland', locale: 'de-DE' };

async function signup(browser, name, email, extra = {}) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 }, ...extra });
  await ctx.request.post('/api/auth/signup', { data: { name, email, password: 'dead-ends-123', tosAccepted: true, privacyAccepted: true } });
  await ctx.request.post('/api/next/onboarding/complete');
  return ctx;
}

async function seed(browser) {
  const admin = await signup(browser, 'Founder', 'founder@example.com', FAR_AWAY);
  const ids = [];
  for (const [name, genre, r] of [['Nova Reyes', 'Pop', 9], ['Lumen', 'Pop/R&B', 8], ['Hollow Pines', 'Country', 7], ['Grit Theory', 'Rock/Alternative', 6], ['Sable', 'R&B', 5]]) {
    const res = await admin.request.post('/api/artists', { data: { name, genre, bio: `${name} makes music.`, score_rationale: 'Strong songs.', youtube_url: 'https://www.youtube.com/@example', music_talent: r, growth_velocity: r, engagement_quality: r, original_song_response: r, brand_personality: r, content_consistency: r, commercial_potential: r, professionalism: r } });
    ids.push((await res.json()).id);
  }
  const player = await signup(browser, 'Pat Player', 'pat@example.com');
  const artistUser = await signup(browser, 'Nova Real', 'nova@example.com');
  let k = 0;
  for (const ctx of [admin, player]) for (const id of ids.slice(0, 3)) await ctx.request.post(`/api/next/artists/${id}/trade`, { data: { type: 'buy', credits_amount_cents: 20000, idempotencyKey: `d${k++}` } });
  await player.request.post(`/api/next/watchlist`, { data: { artistId: ids[3] } }).catch(() => {});
  await player.request.post(`/api/next/artists/${ids[3]}/watchlist`).catch(() => {});
  const lg = await player.request.post('/api/next/leagues', { data: { name: 'Sweep League' } });
  const lgBody = await lg.json();
  if (!lgBody.league) throw new Error(`league create failed: ${lg.status()} ${JSON.stringify(lgBody)}`);
  const league = lgBody.league;
  await admin.request.post('/api/next/leagues/join', { data: { code: league.inviteCode } });
  const artistUserId = sql("SELECT id FROM users WHERE email='nova@example.com';");
  sql(`UPDATE artists SET claimed_by_user_id = ${artistUserId} WHERE id = ${ids[0]};`);
  const now = new Date().toISOString();
  for (const id of ids) sql(`INSERT INTO feed_events (event_type, artist_id, visibility, dedupe_key, created_at) VALUES ('new_artist', ${id}, 'public', 'seed-${id}', '${now}');`);
  const col = await admin.request.post('/api/collections', { data: { title: 'Sweep Picks', description: 'Seeded.' } });
  const colId = (await col.json()).collection.id;
  await admin.request.post(`/api/collections/${colId}/items`, { data: { artistId: ids[1], note: 'Great hooks' } });
  await admin.request.patch(`/api/collections/${colId}`, { data: { published: true } });
  await player.request.post(`/api/next/artists/${ids[2]}/requests`, { data: { kind: 'correction', message: 'The genre listed is wrong here.' } });
  await player.request.post('/api/next/feedback', { data: { understood: 'yes', enjoyed: 'Fun' } });
  await player.request.post('/api/next/feed/posts', { data: { artistId: ids[1], body: 'Lumen is going places.' } }).catch(() => {});
  return { admin, player, artistUser, ids, league };
}

async function isDeadPage(page) {
  const h1 = (await page.locator('h1').first().textContent({ timeout: 2000 }).catch(() => '')) || '';
  if (/page not found|404|something went wrong/i.test(h1)) return h1.trim();
  const title = await page.title();
  if (/404|not found/i.test(title)) return `title: ${title}`;
  return null;
}

async function clickButtons(ctx, path, role) {
  const page = await ctx.newPage();
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  // An already-selected toggle (the "All" filter that's on, the Buy tab when
  // buying) does nothing when clicked again, correctly — skip those.
  const names = await page.evaluate(() => [...document.querySelectorAll('button, [role="button"], a[href="#"], a[href^="javascript:"]')]
    .filter((el) => el.offsetParent !== null && !el.disabled && !el.closest('[aria-hidden="true"]'))
    .filter((el) => el.getAttribute('aria-pressed') !== 'true' && el.getAttribute('aria-selected') !== 'true' && !el.hasAttribute('aria-current'))
    .map((el) => (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)));
  await page.close();
  const seen = new Set();
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (seen.has(name)) continue;
    seen.add(name);
    const testKey = `${role} ${pattern(path)} ${name}`;
    if (tested.has(testKey)) continue;
    tested.add(testKey);
    if (!name) { report('unnamed button', `${role} ${path}`, `button #${i} has no text or label`); continue; }
    if (DESTRUCTIVE.test(name)) { skipped.add(`${name}`); continue; }
    const p = await ctx.newPage();
    p.on('dialog', (d) => d.dismiss().catch(() => {}));
    p.on('pageerror', (e) => report('client error', `${role} ${path}`, `after "${name}": ${String(e).slice(0, 160)}`));
    try {
      await p.goto(BASE + path, { waitUntil: 'networkidle' });
      // Close the onboarding dialog if it's showing, so it doesn't swallow clicks.
      const target = p.locator('button, [role="button"], a[href="#"], a[href^="javascript:"]').filter({ visible: true });
      const count = await target.count();
      let el = null;
      for (let j = 0; j < count; j++) {
        const t = target.nth(j);
        const n = ((await t.getAttribute('aria-label')) || (await t.textContent()) || '').trim().replace(/\s+/g, ' ').slice(0, 60);
        if (n === name && (await t.isEnabled()) && (await t.getAttribute('aria-pressed')) !== 'true') { el = t; break; }
      }
      if (!el) continue;
      const before = p.url();
      let requests = 0, dialogs = 0, popups = 0;
      p.on('request', (r) => { if (['fetch', 'xhr', 'document'].includes(r.resourceType())) requests++; });
      p.on('dialog', () => { dialogs++; });
      p.context().on('page', () => { popups++; });
      await p.evaluate(() => { window.__muts = 0; new MutationObserver((m) => { window.__muts += m.length; }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }); });
      const validationBlocked = await el.evaluate((b) => b.tagName === 'BUTTON' && b.type === 'submit' && b.form && !b.form.checkValidity());
      await el.click({ timeout: 5000 }).catch((e) => report('unclickable', `${role} ${path}`, `"${name}": ${e.message.split('\n')[0]}`));
      await p.waitForTimeout(900);
      const muts = await p.evaluate(() => window.__muts).catch(() => 1);
      const moved = p.url() !== before;
      if (!moved && !requests && !dialogs && !popups && !muts && !validationBlocked) report('dead button', `${role} ${path}`, `"${name}" does nothing`);
    } catch (e) {
      report('error', `${role} ${path}`, `"${name}": ${String(e.message).split('\n')[0]}`);
    } finally {
      await p.close().catch(() => {});
    }
  }
}

async function crawl(ctx, role, starts, { buttons = true } = {}) {
  const queue = [...starts];
  const visited = new Set();
  const perPattern = new Map();
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(`${new URL(page.url()).pathname}: ${String(e).slice(0, 160)}`));
  while (queue.length) {
    const path = queue.shift();
    const key = path.split('#')[0];
    if (visited.has(key)) continue;
    const pat = pattern(key);
    if ((perPattern.get(pat) ?? 0) >= PER_PATTERN) continue;
    visited.add(key);
    perPattern.set(pat, (perPattern.get(pat) ?? 0) + 1);
    const res = await page.goto(BASE + key, { waitUntil: 'networkidle' }).catch((e) => null);
    if (!res) { report('unreachable', role, key); continue; }
    const finalPath = new URL(page.url()).pathname;
    const dead = await isDeadPage(page);
    if (dead || res.status() >= 400) { report('dead link target', `${role} ${key}`, `${res.status()} ${dead ?? ''}`.trim()); continue; }
    if (finalPath.startsWith('/login') && !key.startsWith('/login')) continue; // a login-only page for this role — fine
    const vw = page.viewportSize()?.width ?? 1280;
    if (vw < 500) {
      // Wider than the phone's screen means sideways scrolling and cut-off,
      // hard-to-tap controls (a mobile browser widens the page to fit).
      // Anything sticking out past the screen that isn't inside its own
      // sideways-scrolling box (a wide table in a scroll box is fine).
      const sticksOut = await page.evaluate((w) => {
        const clipped = (e) => { for (let a = e.parentElement; a; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return a !== document.documentElement && a !== document.body; } return false; };
        const bad = [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > w + 1 && getComputedStyle(e).position !== 'fixed' && !clipped(e));
        return bad.slice(0, 2).map((e) => `${e.tagName.toLowerCase()} "${(e.textContent || '').trim().slice(0, 30)}" reaches ${Math.round(e.getBoundingClientRect().right)}px`);
      }, vw);
      if (sticksOut.length) report('too wide on phone', `${role} ${key}`, `${sticksOut.join('; ')} on a ${vw}px screen`);
    }
    const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')));
    for (const href of links) {
      if (!href || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
      if (href.startsWith('#')) {
        const id = decodeURIComponent(href.slice(1));
        if (id && !(await page.evaluate((i) => !!document.getElementById(i), id))) report('broken anchor', `${role} ${key}`, href);
        continue;
      }
      if (/^https?:/.test(href) && !href.startsWith(BASE)) continue; // external
      const url = new URL(href, BASE + key);
      if (url.pathname.startsWith('/api/')) {
        const r = await ctx.request.get(url.pathname + url.search);
        if (r.status() >= 400) report('dead api link', `${role} ${key}`, `${href} -> ${r.status()}`);
        continue;
      }
      if (url.hash && url.pathname === new URL(BASE + key).pathname) continue;
      queue.push(url.pathname + url.search + url.hash);
      if (url.hash) {
        // e.g. /next/how-it-works#score — check the target exists on that page
        const p2 = await ctx.newPage();
        await p2.goto(url.toString(), { waitUntil: 'networkidle' }).catch(() => {});
        if (!(await p2.evaluate((i) => !!document.getElementById(i), decodeURIComponent(url.hash.slice(1))).catch(() => true))) report('broken anchor', `${role} ${key}`, href);
        await p2.close();
      }
    }
    if (buttons) await clickButtons(ctx, key, role);
  }
  await page.close();
  for (const e of consoleErrors) report('client error', role, e);
  return visited;
}

(async () => {
  const server = spawn('npx', ['next', 'start', '-p', String(PORT)], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: { ...process.env, DATABASE_URL: DEV_DB, DATABASE_SCHEMA: SCHEMA, ADMIN_EMAILS: 'founder@example.com', APP_URL: BASE, NODE_ENV: 'production' } });
  const t0 = Date.now();
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
    const browser = await chromium.launch();
    const s = await seed(browser);
    const guest = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
    const phone = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const phonePlayer = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ...FAR_AWAY, storageState: await s.player.storageState() });
    const counts = {};
    counts.guest = (await crawl(guest, 'guest', ['/', '/next', `/next/leagues/join/${s.league.inviteCode}`, '/login', '/signup', '/forgot-password'])).size;
    counts.player = (await crawl(s.player, 'player', ['/next', '/next/feed', '/next/portfolio', '/next/watchlist', '/next/leagues', '/next/challenges', '/next/notifications', '/next/profile', '/settings', '/next/feedback', '/next/submit-artist'])).size;
    counts.artist = (await crawl(s.artistUser, 'artist', [`/next/my-artist/${s.ids[0]}`, `/next/artists/${s.ids[0]}`])).size;
    counts.admin = (await crawl(s.admin, 'admin', ['/', '/screener', '/metrics', '/collections', '/artist-requests', '/artist-claims', '/discovery', '/admin/users', '/admin/sync', '/admin/discovery', '/admin/scout-accuracy', '/admin/market-integrity', '/admin/feed-reports', '/admin/feedback', '/admin/errors', '/admin/backups', '/admin/audit', `/artists/${s.ids[1]}`, '/artists/new', '/artists/bulk-add'])).size;
    counts.phoneGuest = (await crawl(phone, 'phone-guest', ['/next', `/next/artists/${s.ids[1]}`, '/next/leaderboard'], { buttons: true })).size;
    counts.phonePlayer = (await crawl(phonePlayer, 'phone-player', ['/next', '/next/challenges', '/next/leagues'], { buttons: true })).size;
    const phoneAdmin = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await s.admin.storageState() });
    counts.phoneAdmin = (await crawl(phoneAdmin, 'phone-admin', ['/', '/screener', '/metrics', '/collections', '/artist-requests', '/admin/users', '/settings', `/artists/${s.ids[1]}`], { buttons: false })).size;
    console.log('pages visited:', JSON.stringify(counts));
    await browser.close();
  } catch (e) {
    report('script error', '-', String(e.stack || e));
  } finally {
    process.kill(-server.pid);
    console.log(`\nNot clicked (destructive): ${[...skipped].sort().join(' | ')}`);
    if (problems.length === 0) console.log('\nNo dead ends found.');
    else {
      console.log(`\n${problems.length} problem(s):`);
      for (const p of problems) console.log(`  [${p.kind}] ${p.where} — ${p.what}`);
    }
    console.log(`(${Math.round((Date.now() - t0) / 1000)}s)`);
    process.exit(problems.length === 0 ? 0 : 1);
  }
})();
