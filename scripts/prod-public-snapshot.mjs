// Records what production publicly shows — every listed artist's price, every leaderboard entry's portfolio
// value and P&L, and each public profile's holdings — so the same pages can be compared exactly before and
// after a deployment. Read-only (GET requests only). Prints JSON with ids, prices and amounts.
//
//   APP_URL=https://send-a-shot.onrender.com node scripts/prod-public-snapshot.mjs > before.json
const BASE = process.env.APP_URL ?? 'https://send-a-shot.onrender.com';
const text = (html) => html.replace(/<!-- -->/g, '').replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const get = async (p) => { const r = await fetch(BASE + p, { redirect: 'manual' }); return { status: r.status, html: await r.text() }; };

const discover = await get('/next');
const artistIds = [...new Set([...discover.html.matchAll(/\/next\/artists\/(\d+)/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
const artists = {};
for (const id of artistIds) {
  const { status, html } = await get(`/next/artists/${id}`);
  const t = text(html);
  // the headline price is the first currency amount after the artist name heading
  const price = (t.match(/NEXT Price\s*\$([0-9,]+\.\d\d)/) ?? t.match(/\$([0-9,]+\.\d\d)/) ?? [])[1] ?? null;
  artists[id] = { status, price };
}
const board = await get('/next/leaderboard');
const profileIds = [...new Set([...board.html.matchAll(/\/next\/profile\/(\d+)/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
const leaderboardText = text(board.html);
const profiles = {};
for (const id of profileIds) {
  const { status, html } = await get(`/next/profile/${id}`);
  const t = text(html);
  profiles[id] = { status, amounts: [...t.matchAll(/[+-]?\$[0-9,]+\.\d\d/g)].map((m) => m[0]) };
}
console.log(JSON.stringify({
  takenAt: new Date().toISOString(),
  artists,
  leaderboardAmounts: [...leaderboardText.matchAll(/[+-]?\$[0-9,]+\.\d\d/g)].map((m) => m[0]),
  profiles,
}, null, 1));
