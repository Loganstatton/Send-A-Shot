// Run from the repo root with a production build (`npm run build`) and the
// local dev database (`npm run db:dev`). See e2e/README.md.
const { ROOT, DEV_DB } = require('./env');
// Security checks over real HTTP against the production build.
const { spawn } = require('child_process');
const { request } = require('playwright');
const PORT = 3117, BASE = `http://localhost:${PORT}`;
const results = []; const check = (n, c, d = '') => { results.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
(async () => {
  const server = spawn('npx', ['next', 'start', '-p', String(PORT)], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: { ...process.env, DATABASE_URL: DEV_DB, DATABASE_SCHEMA: `e2e_sec_${Date.now()}`, ADMIN_EMAILS: 'founder@example.com', APP_URL: BASE, NODE_ENV: 'production' } });
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
    const ctx = () => request.newContext({ baseURL: BASE });
    const a = await ctx();
    const su = await a.post('/api/auth/signup', { data: { name: 'Sec User', email: 'sec@example.com', password: 'right-password-1', tosAccepted: true, privacyAccepted: true } });
    check('signup works', su.status() === 201, String(su.status()));

    // Security headers.
    const page = await fetch(`${BASE}/next`);
    const h = page.headers;
    check('pages send anti-framing and other security headers',
      (h.get('content-security-policy') || '').includes("frame-ancestors 'none'") && h.get('x-frame-options') === 'DENY' &&
      h.get('x-content-type-options') === 'nosniff' && !!h.get('referrer-policy') && !!h.get('strict-transport-security') && !h.get('x-powered-by'));

    // Login: wrong password vs unknown email look the same.
    const bad = await (await ctx()).post('/api/auth/login', { data: { email: 'sec@example.com', password: 'wrong' } });
    const unknown = await (await ctx()).post('/api/auth/login', { data: { email: 'nobody@example.com', password: 'wrong' } });
    check('wrong password and unknown email give the same answer', bad.status() === 401 && unknown.status() === 401 && (await bad.text()) === (await unknown.text()));
    const forgotKnown = await (await ctx()).post('/api/auth/forgot-password', { data: { email: 'sec@example.com' } });
    const forgotUnknown = await (await ctx()).post('/api/auth/forgot-password', { data: { email: 'nobody@example.com' } });
    check('password reset does not reveal whether an account exists', (await forgotKnown.text()) === (await forgotUnknown.text()));

    // Brute force: 8 failures lock the email for 15 minutes — even the right password.
    const victim = await ctx();
    await victim.post('/api/auth/signup', { data: { name: 'Victim', email: 'victim@example.com', password: 'victim-pass-123', tosAccepted: true, privacyAccepted: true } });
    let last;
    for (let i = 0; i < 8; i++) last = await (await ctx()).post('/api/auth/login', { data: { email: 'victim@example.com', password: `guess-${i}` } });
    const locked = await (await ctx()).post('/api/auth/login', { data: { email: 'victim@example.com', password: 'victim-pass-123' } });
    check('repeated failed logins are rate limited (429 with Retry-After)', last.status() === 401 && locked.status() === 429 && !!locked.headers()['retry-after']);
    const other = await (await ctx()).post('/api/auth/login', { data: { email: 'sec@example.com', password: 'right-password-1' } });
    check('other accounts can still log in', other.status() === 200);

    // Cross-site write blocked; same-site allowed.
    const evil = await a.post('/api/next/leagues', { data: { name: 'Evil League' }, headers: { origin: 'https://evil.example' } });
    const same = await a.post('/api/next/leagues', { data: { name: 'Fine League' }, headers: { origin: BASE } });
    check('a write from another site is blocked', evil.status() === 403);
    check('the same write from this site works', same.status() === 201);

    // Sessions: phone + laptop; password change on laptop signs phone out.
    const laptop = await ctx(); const phone = await ctx();
    await laptop.post('/api/auth/login', { data: { email: 'sec@example.com', password: 'right-password-1' } });
    await phone.post('/api/auth/login', { data: { email: 'sec@example.com', password: 'right-password-1' } });
    const before = await phone.post('/api/next/leagues', { data: { name: 'Phone League' } });
    const change = await laptop.post('/api/account/password', { data: { currentPassword: 'right-password-1', newPassword: 'new-password-22' } });
    const phoneAfter = await phone.post('/api/next/leagues', { data: { name: 'Phone League 2' } });
    const laptopAfter = await laptop.post('/api/next/leagues', { data: { name: 'Laptop League' } });
    check('changing the password signs out other devices but not this one', before.status() === 201 && change.status() === 200 && phoneAfter.status() === 401 && laptopAfter.status() === 201,
      `${before.status()} ${change.status()} ${phoneAfter.status()} ${laptopAfter.status()}`);
    const tablet = await ctx();
    await tablet.post('/api/auth/login', { data: { email: 'sec@example.com', password: 'new-password-22' } });
    const revoke = await laptop.post('/api/account/sessions');
    const tabletAfter = await tablet.post('/api/next/leagues', { data: { name: 'Tablet League' } });
    const laptopStill = await laptop.post('/api/next/leagues', { data: { name: 'Laptop League 2' } });
    check('"log out of all other devices" ends other sessions only', revoke.status() === 200 && tabletAfter.status() === 401 && laptopStill.status() === 201);

    // Authorization spot checks.
    const pub = await ctx();
    await pub.post('/api/auth/signup', { data: { name: 'Plain', email: 'plain@example.com', password: 'plain-pass-123', tosAccepted: true, privacyAccepted: true } });
    const checks = [
      ['POST', '/api/artists', { name: 'X' }], ['PATCH', '/api/admin/users/1/role', { role: 'admin' }], ['POST', '/api/collections', { title: 'Nope nope' }],
      ['PATCH', '/api/artist-requests/1', { decision: 'resolved', note: 'x' }], ['POST', '/api/admin/backup', {}],
    ];
    let denied = 0;
    for (const [m, url, data] of checks) {
      const r = await pub.fetch(url, { method: m, data });
      if (r.status() === 401 || r.status() === 403) denied++; else console.log('   allowed?', m, url, r.status());
    }
    check('a public player is refused on staff/admin endpoints', denied === checks.length, `${denied}/${checks.length}`);
    const adminPage = await pub.get('/admin/audit', { maxRedirects: 0 });
    { const t = await adminPage.text(); check('a public player cannot see the admin audit log contents', !t.includes('Role changes, backups and restores') && !t.includes('role changed') && t.includes('NEXT_REDIRECT')); }

    // Malicious input stays inert.
    const xss = await pub.post('/api/next/leagues', { data: { name: '<img src=x onerror=alert(1)>' } });
    const id = (await xss.json()).league.id;
    const html = await (await pub.get(`/next/leagues/${id}`)).text();
    check('script-like input is escaped, not executed', !html.includes('<img src=x onerror') && html.includes('&lt;img'));
    const sqli = await pub.post('/api/next/leagues/join', { data: { code: "x' OR '1'='1" } });
    check("SQL-like input is treated as data", sqli.status() === 404);
  } catch (e) { check('ran', false, String(e.stack || e)); }
  finally { process.kill(-server.pid); console.log(`${results.filter(Boolean).length}/${results.length} passed`); }
})();
