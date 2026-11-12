// Run from the repo root with a production build (`npm run build`) and the
// local dev database (`npm run db:dev`). See e2e/README.md.
const { ROOT, DEV_DB } = require('./env');
// axe-core WCAG 2.1 A/AA audit of the main pages, signed out and signed in,
// desktop and phone. Prints each violation once with the pages it's on.
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('playwright');
const path = require('path');
const AXE = process.env.AXE_PATH || require.resolve('axe-core/axe.min.js');
const PORT = 3119, BASE = `http://localhost:${PORT}`;
const SCHEMA = `e2e_axe_${Date.now()}`;
const sql = (q) => execFileSync('psql', [DEV_DB, '-c', `SET search_path=${SCHEMA}; ${q}`], { encoding: 'utf8' });
(async () => {
  const server = spawn('npx', ['next', 'start', '-p', String(PORT)], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: { ...process.env, DATABASE_URL: DEV_DB, DATABASE_SCHEMA: SCHEMA, ADMIN_EMAILS: 'founder@example.com', APP_URL: BASE, NODE_ENV: 'production' } });
  const found = new Map();
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
    const browser = await chromium.launch();
    const admin = await browser.newContext({ baseURL: BASE });
    await admin.request.post('/api/auth/signup', { data: { name: 'Founder', email: 'founder@example.com', password: 'founder-pass-123', tosAccepted: true, privacyAccepted: true } });
    await admin.request.post('/api/next/onboarding/complete');
    const ids = [];
    for (const [name, genre] of [['Nova Reyes', 'Pop'], ['Lumen', 'Pop/R&B'], ['Hollow Pines', 'Country']]) {
      const r = await admin.request.post('/api/artists', { data: { name, genre, bio: 'Emerging artist.', score_rationale: 'Strong songs.', music_talent: 8, growth_velocity: 7, engagement_quality: 7, original_song_response: 8, brand_personality: 6, content_consistency: 6, commercial_potential: 6, professionalism: 7 } });
      ids.push((await r.json()).id);
    }
    let k = 0;
    for (const id of ids) await admin.request.post(`/api/next/artists/${id}/trade`, { data: { type: 'buy', credits_amount_cents: 20000, idempotencyKey: `a${k++}` } });
    const lg = await admin.request.post('/api/next/leagues', { data: { name: 'Axe League' } });
    const league = (await lg.json()).league;
    const proofId = sql('SELECT id FROM next_founding_believers LIMIT 1;').match(/\n\s*(\d+)\n/)[1];
    for (const id of ids) sql(`INSERT INTO feed_events (event_type, artist_id, visibility, dedupe_key, created_at) VALUES ('new_artist', ${id}, 'public', 'axe-${id}', '${new Date().toISOString()}');`);

    const guestPages = ['/next', `/next/artists/${ids[0]}`, '/next/how-it-works', '/next/leaderboard', '/next/leaderboard?board=talent', '/next/genres', '/next/genres/pop', `/next/proof/${proofId}`, `/next/leagues/join/${league.inviteCode}`, '/login', '/signup', '/terms', '/privacy'];
    const userPages = ['/next', `/next/artists/${ids[0]}`, '/next/feed', '/next/portfolio', '/next/watchlist', '/next/leagues', `/next/leagues/${league.id}`, '/next/challenges', '/next/notifications', '/next/profile/1', '/next/submit-artist', '/next/feedback', '/settings'];
    const runs = [
      ['guest', null, guestPages, { width: 1280, height: 900 }],
      ['guest-phone', null, guestPages.slice(0, 4), { width: 390, height: 844 }],
      ['signed-in', admin, userPages, { width: 1280, height: 900 }],
    ];
    for (const [label, ctx, pages, viewport] of runs) {
      const c = ctx ?? await browser.newContext({ baseURL: BASE });
      const page = await c.newPage();
      await page.setViewportSize(viewport);
      for (const p of pages) {
        await page.goto(BASE + p, { waitUntil: 'networkidle' });
        await page.waitForTimeout(300);
        await page.addScriptTag({ path: AXE });
        const res = await page.evaluate(async () => await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }));
        for (const v of res.violations) {
          const key = v.id;
          const entry = found.get(key) ?? { impact: v.impact, help: v.help, pages: new Set(), examples: [] };
          entry.pages.add(`${label}:${p}`);
          for (const n of v.nodes.slice(0, 2)) if (entry.examples.length < 4) entry.examples.push(`${n.target.join(' ')} — ${(n.failureSummary || '').split('\n')[1]?.trim() ?? ''}`);
          found.set(key, entry);
        }
      }
    }
    await browser.close();
  } catch (e) { console.log('ERROR', e.stack || e); }
  finally {
    process.kill(-server.pid);
    if (found.size === 0) console.log('NO VIOLATIONS');
    for (const [id, e] of found) {
      console.log(`\n[${e.impact}] ${id}: ${e.help}`);
      console.log('  pages:', [...e.pages].join(', '));
      for (const x of e.examples) console.log('   e.g.', x);
    }
  }
})();
