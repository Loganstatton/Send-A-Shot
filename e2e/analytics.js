// Run from the repo root with a production build (`npm run build`) and the
// local dev database (`npm run db:dev`). See e2e/README.md.
const { ROOT, DEV_DB } = require('./env');
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const PORT = 3116, BASE = `http://localhost:${PORT}`, SHOTS = require('path').join(__dirname, 'screenshots');
const results = []; const check = (n, c, d = '') => { results.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
(async () => {
  const server = spawn('npx', ['next', 'start', '-p', String(PORT)], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: { ...process.env, DATABASE_URL: DEV_DB, DATABASE_SCHEMA: `e2e_an_${Date.now()}`, ADMIN_EMAILS: 'founder@example.com', APP_URL: BASE, NODE_ENV: 'production' } });
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
    const browser = await chromium.launch(); const errors = [];
    const admin = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
    await admin.request.post('/api/auth/signup', { data: { name: 'Founder', email: 'founder@example.com', password: 'founder-pass-123', tosAccepted: true, privacyAccepted: true } });
    await admin.request.post('/api/next/onboarding/complete');
    const lg = await admin.request.post('/api/next/leagues', { data: { name: 'Pulse League' } });
    const code = (await lg.json()).league.inviteCode;

    // A guest signs up from the league invite, in the browser.
    const g = await (await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 } })).newPage();
    g.on('pageerror', (e) => errors.push(String(e)));
    await g.goto(`${BASE}/next/leagues/join/${code}`, { waitUntil: 'networkidle' });
    await g.getByRole('link', { name: 'Sign up free to join' }).click();
    await g.waitForURL(/\/signup/);
    await g.getByLabel('Name').fill('Ivy Invitee');
    await g.getByLabel('Email').fill('ivy@example.com');
    await g.getByLabel('Password').fill('ivy-pass-12345');
    for (const cb of await g.locator('input[type="checkbox"]').all()) await cb.check();
    await g.getByRole('button', { name: /sign up|create account/i }).click();
    await g.waitForURL(/\/next\/leagues\/join\//);
    await g.request.post('/api/next/onboarding/complete');

    // Footer -> feedback.
    await g.goto(`${BASE}/next/how-it-works`, { waitUntil: 'networkidle' });
    const footerLink = g.getByRole('link', { name: 'Send feedback (beta)' });
    check('footer shows the virtual-credits note and a feedback link', (await g.locator('footer').innerText()).includes("can't be bought or cashed out") && (await footerLink.count()) === 1);
    await footerLink.click();
    await g.waitForURL(/\/next\/feedback\?from=/);
    await g.getByText('Partly').click();
    await g.getByLabel('What did you enjoy?').fill('Proving I found an artist first.');
    await g.getByLabel(/What confused you/).fill('Not sure when the Price moves.');
    await g.getByRole('button', { name: 'Send feedback' }).click();
    check('player can send feedback', await g.getByText('every note gets read').isVisible().catch(() => false) || (await g.getByText('every note gets read').waitFor({ timeout: 8000 }).then(() => true).catch(() => false)));
    await g.screenshot({ path: `${SHOTS}/feedback-mobile.png`, fullPage: true });

    const ap = await admin.newPage(); ap.on('pageerror', (e) => errors.push(String(e)));
    await ap.goto(`${BASE}/admin/feedback`, { waitUntil: 'networkidle' });
    let body = await ap.locator('body').innerText();
    check('admin sees the feedback, its page and the summary', body.includes('Proving I found an artist first.') && body.includes('from /next/how-it-works') && /1 response/.test(body) && body.includes('1 partly'));
    await ap.goto(`${BASE}/metrics`, { waitUntil: 'networkidle' });
    body = await ap.locator('body').innerText();
    check('metrics attribute the signup to the league invite', /1\s*—\s*league invite/.test(body), body.slice(body.indexOf('Where signups'), body.indexOf('Where signups') + 160).replace(/\n/g, ' | '));
    check('metrics show the activity pulse', /Activity pulse/.test(body) && /Active today/i.test(body) && /Understood the scoring/i.test(body));
    check('no client errors', errors.length === 0, errors.join(' | '));
    await browser.close();
  } catch (e) { check('ran', false, String(e.stack || e)); }
  finally { process.kill(-server.pid); console.log(`${results.filter(Boolean).length}/${results.length} passed`); }
})();
