// Run from the repo root with a production build (`npm run build`) and the
// local dev database (`npm run db:dev`). See e2e/README.md.
const { ROOT, DEV_DB } = require('./env');
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const PORT = 3120, BASE = `http://localhost:${PORT}`;
const results = []; const check = (n, c, d = '') => { results.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
(async () => {
  const server = spawn('npx', ['next', 'start', '-p', String(PORT)], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: { ...process.env, DATABASE_URL: DEV_DB, DATABASE_SCHEMA: `e2e_kb_${Date.now()}`, APP_URL: BASE, NODE_ENV: 'production' } });
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
    const browser = await chromium.launch();
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await page.goto(`${BASE}/next`, { waitUntil: 'networkidle' });
    await page.keyboard.press('Tab');
    const first = await page.evaluate(() => ({ text: document.activeElement?.textContent, left: document.activeElement?.getBoundingClientRect().left }));
    check('first Tab lands on a visible "Skip to content" link', first.text === 'Skip to content' && first.left >= 0, JSON.stringify(first));
    await page.keyboard.press('Enter');
    check('Enter moves focus to the main content', await page.evaluate(() => document.activeElement?.id === 'main-content'));
    for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return { tag: document.activeElement.tagName, outline: s.outlineStyle, width: s.outlineWidth }; });
    check('focused controls show a visible outline', ring.outline === 'solid' && ring.width === '2px', JSON.stringify(ring));
    await browser.close();
  } catch (e) { check('ran', false, String(e.stack || e)); }
  finally { process.kill(-server.pid); console.log(`${results.filter(Boolean).length}/${results.length} passed`); }
})();
