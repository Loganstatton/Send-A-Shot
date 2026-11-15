// Phase 1 market maker, end to end on a production build and a real Postgres (its own fresh schema):
// the fee is shown in the trade panel before a purchase is confirmed; the market maker, reserve and limits
// are disclosed; an admin can preview and approve a depth change (and nobody else can); reconciliation
// passes over real HTTP; a paused artist can't be traded until an admin resumes it; the new-account limit
// and the quote guard work with their real defaults. Run: node e2e/run-all.js market-maker
const { spawn, execFileSync } = require('child_process');
const { chromium, request } = require('playwright');
const { ROOT, DEV_DB } = require('./env');

const PORT = 3122;
const BASE = `http://localhost:${PORT}`;
const SCHEMA = `e2e_market_maker_${Date.now()}`;
const results = [];
const check = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const sql = (q) => execFileSync('psql', [DEV_DB, '-At', '-c', `SET search_path=${SCHEMA}; ${q}`], { encoding: 'utf8' }).trim().split('\n').pop();

(async () => {
  // Real defaults: the new-account window is ON here (3 days), unlike the other suites.
  const server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
    cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NEXT_NEW_ACCOUNT_DAYS: '3', DATABASE_URL: DEV_DB, DATABASE_SCHEMA: SCHEMA, ADMIN_EMAILS: 'founder@example.com', APP_URL: BASE, NODE_ENV: 'production' },
  });
  let log = ''; server.stdout.on('data', (d) => (log += d)); server.stderr.on('data', (d) => (log += d));
  let browser;
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
    const signup = async (name, email) => {
      const ctx = await request.newContext({ baseURL: BASE });
      const r = await ctx.post('/api/auth/signup', { data: { name, email, password: 'market-maker-9', tosAccepted: true, privacyAccepted: true } });
      if (r.status() !== 201) throw new Error(`signup ${email}: ${r.status()}`);
      await ctx.post('/api/next/onboarding/complete');
      return ctx;
    };
    const founder = await signup('Founder', 'founder@example.com');
    const newArtist = async (name) => (await (await founder.post('/api/artists', { data: { name, genre: 'Pop', music_talent: 7, growth_velocity: 7, engagement_quality: 7,
      original_song_response: 7, brand_personality: 7, content_consistency: 7, commercial_potential: 7, professionalism: 7 } })).json()).id;
    const artistId = await newArtist('Market Maker Artist');
    const age = (email) => sql(`UPDATE users SET created_at = '2026-01-01T00:00:00.000Z' WHERE email = '${email}'`);

    // --- the trade panel shows the fee before confirming (real browser) ---
    const fan = await signup('Fee Fan', 'fan@example.com'); age('fan@example.com');
    browser = await chromium.launch();
    const ctx = await browser.newContext({ storageState: await fan.storageState(), viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${BASE}/next/artists/${artistId}`);
    await page.locator('#trade-panel-next-credits').fill('100');
    const panel = page.locator('#trade-panel');
    const panelText = await panel.innerText();
    check('artist lists at 10 Credits a share', panelText.includes('$10.00') || (await page.content()).includes('$10.00'));
    check('before confirming, the panel shows the 0.5% fee and what goes into the market', /Trading fee \(0\.5%\)\s*\$0\.50/.test(panelText) && /Goes into the market\s*\$99\.50/.test(panelText), panelText.replace(/\s+/g, ' ').slice(0, 400));
    check('it shows buy and sell quotes for 100 Credits', /Buy 100 Credits/.test(panelText) && /Sell 100 Credits/.test(panelText));
    check('it names the market maker as counterparty and says Credits have no cash value', /NEXT market maker/.test(panelText) && /no cash value/.test(panelText));
    await page.getByRole('button', { name: 'Review purchase' }).click();
    const confirmText = await panel.innerText();
    check('the confirmation repeats the fee', /Of which trading fee \(0\.5%\)\s*\$0\.50/.test(confirmText));
    await page.getByRole('button', { name: 'Confirm purchase' }).click();
    await page.getByText(/Bought .* \(fee \$0\.50\)/).waitFor({ timeout: 15000 });
    check('the purchase fills and reports the fee', true);
    check('no page errors in the trade flow', errors.length === 0, errors.join(' | '));
    check('the fee is recorded on the trade', sql(`SELECT fee_cents FROM next_transactions WHERE user_id = (SELECT id FROM users WHERE email='fan@example.com')`) === '50');

    // --- How it works discloses the new rules ---
    const how = (await (await fetch(`${BASE}/next/how-it-works`)).text()).replace(/<!-- -->/g, '').replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'");
    check('How it works explains the market maker, reserve, fee, uniform listing and limits',
      how.includes('the NEXT market maker') && how.includes('0.5% trading fee') && how.includes('$10.00 a share') && how.includes('reserve') && how.includes('Selling is never limited'));

    // --- admin: overview, reconciliation, depth preview + approval; non-admins refused ---
    let r = await founder.get('/api/admin/market');
    const overview = await r.json();
    check('admin sees the market overview and the migration proof', r.ok() && Array.isArray(overview.overview.artists) && overview.migration && typeof overview.migration.ok === 'boolean');
    r = await founder.post('/api/admin/market/reconcile');
    const recon = await r.json();
    check('reconciliation over HTTP: all checks pass', r.status() === 200 && recon.ok === true, JSON.stringify(recon.issues ?? recon).slice(0, 300));
    r = await fan.post('/api/admin/market/reconcile');
    check('a player cannot run reconciliation', r.status() === 401);
    const depth = Number(sql(`SELECT next_depth_cents FROM artists WHERE id=${artistId}`));
    r = await founder.get(`/api/admin/market/depth?artistId=${artistId}&depthCents=${Math.round(depth * 1.2)}`);
    const preview = await r.json();
    check('depth preview: allowed, price unchanged, holders only gain', r.ok() && preview.ok && preview.holders.count === 1 && preview.holders.smallestChangePct >= 0, JSON.stringify(preview).slice(0, 200));
    r = await founder.get(`/api/admin/market/depth?artistId=${artistId}&depthCents=${Math.round(depth * 1.3)}`);
    check('depth preview refuses more than ×1.25', (await r.json()).ok === false);
    r = await fan.post('/api/admin/market/depth', { data: { artistId, newDepthCents: Math.round(depth * 1.2) } });
    check('a player cannot change depth', r.status() === 401);
    const priceBefore = sql(`SELECT next_current_price_cents FROM artists WHERE id=${artistId}`);
    r = await founder.post('/api/admin/market/depth', { data: { artistId, newDepthCents: Math.round(depth * 1.2), note: 'e2e' } });
    check('an admin approves a depth increase', r.ok(), await r.text());
    check('the price did not move', sql(`SELECT next_current_price_cents FROM artists WHERE id=${artistId}`) === priceBefore);
    check('the change is in the audit log', sql("SELECT COUNT(*) FROM admin_audit_log WHERE action = 'market_depth_changed'") === '1');
    r = await founder.post('/api/admin/market/reconcile');
    check('books still balance after the depth change', (await r.json()).ok === true);
    const adminPage = await (await founder.get('/admin/market')).text();
    check('the admin Market maker page renders', adminPage.includes('Market maker') && adminPage.includes('Phase 1 migration proof'));

    // --- circuit breaker: paused artist refuses trades until resumed ---
    r = await founder.post('/api/admin/market/halt', { data: { artistId, action: 'halt', reason: 'e2e check' } });
    check('an admin pauses trading in an artist', r.ok());
    r = await fan.post(`/api/next/artists/${artistId}/trade`, { data: { type: 'buy', credits_amount_cents: 1000, idempotencyKey: 'halted-1' } });
    check('a paused artist refuses trades, with a reassuring message', r.status() === 400 && /paused while the market is checked/.test((await r.json()).error));
    r = await founder.post('/api/admin/market/halt', { data: { artistId, action: 'resume' } });
    r = await fan.post(`/api/next/artists/${artistId}/trade`, { data: { type: 'sell', credits_amount_cents: 999_999_999_999, idempotencyKey: 'resumed-1' } });
    check('after resuming, the holder sells out', r.ok());

    // --- new-account limit with its real default (3 days, 2,500 Credits per artist per day) ---
    const newbie = await signup('Newbie', 'newbie@example.com');
    r = await newbie.post(`/api/next/artists/${artistId}/trade`, { data: { type: 'buy', credits_amount_cents: 300_000, idempotencyKey: 'nb-1' } });
    check('a brand-new account cannot put more than 2,500 Credits into one artist on day one', r.status() === 400 && /New accounts can buy up to 2,500 Credits/.test((await r.json()).error));
    r = await newbie.post(`/api/next/artists/${artistId}/trade`, { data: { type: 'buy', credits_amount_cents: 250_000, idempotencyKey: 'nb-2' } });
    check('…but can buy up to the limit', r.ok());
    r = await newbie.post(`/api/next/artists/${artistId}/trade`, { data: { type: 'sell', credits_amount_cents: 999_999_999_999, idempotencyKey: 'nb-3' } });
    check('…and can always sell', r.ok());

    // --- quote guard ---
    const whale = await signup('Whale', 'whale@example.com'); age('whale@example.com');
    const quoted = Number(sql(`SELECT next_current_price_cents FROM artists WHERE id=${artistId}`));
    await whale.post(`/api/next/artists/${artistId}/trade`, { data: { type: 'buy', credits_amount_cents: 1_000_000, idempotencyKey: 'w-1' } });
    r = await fan.post(`/api/next/artists/${artistId}/trade`, { data: { type: 'buy', credits_amount_cents: 10_000, quotedPriceCents: quoted, idempotencyKey: 'stale-1' } });
    check('an order is refused when the price moved more than 2% since the quote', r.status() === 400 && /price moved/.test((await r.json()).error));

    r = await founder.post('/api/admin/market/reconcile');
    check('final reconciliation: all checks pass', (await r.json()).ok === true);
  } catch (e) {
    check('suite ran without errors', false, String((e && e.stack) || e) + '\n' + log.slice(-2000));
  } finally {
    try { await browser?.close(); } catch {}
    try { process.kill(-server.pid, 'SIGKILL'); } catch {}
    try { execFileSync('psql', [DEV_DB, '-c', `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`], { stdio: 'ignore' }); } catch {}
  }
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})();
