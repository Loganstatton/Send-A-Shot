// Run from the repo root with a production build (`npm run build`) and the
// local dev database (`npm run db:dev`). See e2e/README.md.
const { ROOT, DEV_DB } = require('./env');
// Discovery: genre pages, artist prev/next + genre link, New on NEXT,
// editorial collections (staff editor -> publish -> public page/Discover).
const { spawn } = require('child_process');
const { chromium, request } = require('playwright');
const PORT = 3114, BASE = `http://localhost:${PORT}`, SHOTS = require('path').join(__dirname, 'screenshots');
const results = []; const check = (n, c, d = '') => { results.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
(async () => {
  const server = spawn('npx', ['next', 'start', '-p', String(PORT)], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: { ...process.env, DATABASE_URL: DEV_DB, DATABASE_SCHEMA: `e2e_disc_${Date.now()}`, ADMIN_EMAILS: 'founder@example.com', APP_URL: BASE, NODE_ENV: 'production' } });
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
    const browser = await chromium.launch(); const errors = [];
    const staff = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
    await staff.request.post('/api/auth/signup', { data: { name: 'Founder', email: 'founder@example.com', password: 'founder-pass-123', tosAccepted: true, privacyAccepted: true } });
    await staff.request.post('/api/next/onboarding/complete');
    const seed = [['Nova Reyes', 'Pop', 9], ['Lumen', 'Pop/R&B', 8], ['Hollow Pines', 'Country', 7], ['Grit Theory', 'Rock/Alternative', 6], ['Sable', 'R&B', 5]];
    const ids = {};
    for (const [name, genre, r] of seed) {
      const res = await staff.request.post('/api/artists', { data: { name, genre, bio: 'x', music_talent: r, growth_velocity: r, engagement_quality: r, original_song_response: r, brand_personality: r, content_consistency: r, commercial_potential: r, professionalism: r } });
      ids[name] = (await res.json()).id;
    }
    const sp = await staff.newPage(); sp.on('pageerror', (e) => errors.push(String(e)));
    await sp.goto(BASE + '/collections', { waitUntil: 'networkidle' });
    await sp.getByLabel('Title').fill('Late Night R&B');
    await sp.getByLabel('Description').fill('Slow-burning voices for after midnight.');
    await sp.getByRole('button', { name: /Create/ }).click();
    await sp.waitForURL(/\/collections\/\d+$/);
    for (const [name, note] of [['Sable', 'Velvet vocals'], ['Lumen', 'Pop hooks, R&B heart']]) {
      await sp.getByLabel('Artist', { exact: true }).selectOption({ label: name });
      await sp.getByLabel('Note (shown publicly)').fill(note);
      await sp.getByRole('button', { name: 'Add', exact: true }).click();
      await sp.getByText('Added.').waitFor();
    }
    await sp.getByRole('button', { name: 'Move Lumen up' }).click();
    await sp.waitForTimeout(800);
    await sp.getByRole('button', { name: 'Publish' }).click();
    await sp.getByText('Published.').waitFor();
    await sp.waitForTimeout(1000);
    console.log('EDITOR:', JSON.stringify((await sp.locator('ol').last().innerText()).slice(0, 300)), '| links:', await sp.getByRole('link', { name: 'View on NEXT' }).count(), '| status:', JSON.stringify(await sp.locator('form').first().innerText()).slice(0, 120));
    check('staff can create, fill, reorder and publish a collection', (await sp.getByRole('link', { name: 'View on NEXT' }).count()) === 1);

    const guest = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const gp = await guest.newPage(); gp.on('pageerror', (e) => errors.push(String(e)));
    await gp.goto(BASE + '/next', { waitUntil: 'networkidle' });
    let body = await gp.locator('body').innerText();
    check('Discover shows the published collection', /Collections from our Scouts/i.test(body) && body.includes('Late Night R&B'));
    check('New on NEXT is hidden when every artist is new (it would just repeat the grid)', !/New on NEXT/i.test(body));
    check('Discover links genre pages', (await gp.locator('a[href="/next/genres/rnb"]').count()) >= 1);
    await gp.screenshot({ path: `${SHOTS}/discover-collections-mobile.png`, fullPage: true });
    await gp.getByRole('link', { name: /Late Night R&B/ }).click();
    await gp.waitForURL(/\/next\/collections\//);
    await gp.getByRole('heading', { name: 'Late Night R&B' }).waitFor();
    body = await gp.locator('body').innerText();
    console.log('PUBLIC:', JSON.stringify(body.slice(body.indexOf('Late Night'), body.indexOf('Late Night') + 400)));
    check('public collection page lists artists in order with notes', body.indexOf('Lumen') < body.indexOf('Sable') && body.includes('Velvet vocals') && body.includes("can't pay to be included"));
    check('collection page has share metadata', (await gp.locator('meta[property="og:title"]').getAttribute('content')) === 'Late Night R&B');

    const r = await gp.goto(BASE + '/next/genres/rnb', { waitUntil: 'networkidle' });
    body = await gp.locator('body').innerText();
    check('R&B genre page lists Pop/R&B and R&B artists only', r.status() === 200 && body.includes('Lumen') && body.includes('Sable') && !body.includes('Hollow Pines'));
    check('genre page title is shareable', ((await gp.title()) || '').includes('R&B artists to watch'));
    await gp.goto(BASE + '/next/genres', { waitUntil: 'networkidle' });
    check('genre index lists genres with counts', /R&B\s*2 artists/.test(await gp.locator('body').innerText()));

    await gp.goto(`${BASE}/next/artists/${ids['Lumen']}`, { waitUntil: 'networkidle' });
    check('artist page has previous and next artist links', (await gp.locator('a[rel="prev"]').innerText()).includes('Nova Reyes') && (await gp.locator('a[rel="next"]').innerText()).includes('Hollow Pines'));
    check('artist genre links to its genre page', (await gp.locator(`a[href="/next/genres/pop"]`).count()) >= 1);

    const draft = await staff.request.post('/api/collections', { data: { title: 'Secret draft' } });
    const draftSlug = (await draft.json()).collection.slug;
    const d = await gp.goto(`${BASE}/next/collections/${draftSlug}`, { waitUntil: 'networkidle' });
    check('a draft collection is not visible to the public', (await gp.locator('body').innerText()).includes('Secret draft') === false);
    const anon = await (await request.newContext({ baseURL: BASE })).post('/api/collections', { data: { title: 'Nope nope' } });
    check('creating collections needs staff', anon.status() === 401);
    check('no client errors', errors.length === 0, errors.join(' | '));
    await browser.close();
  } catch (e) { check('ran', false, String(e.stack || e)); }
  finally { process.kill(-server.pid); console.log(`${results.filter(Boolean).length}/${results.length} passed`); }
})();
