// Phase 1 staging check (run by .github/workflows/market-audit.yml with target=staging, or locally).
// 1. Reconcile the books.  2. A labelled test account opens an artist's trading panel, checks the quotes and
// the 0.5% fee, buys 100 Credits, and the balance, holding, reserve, fee pool and ledger are checked; then it
// sells everything and the final balance and price are checked.  3. Reconcile again.
// Prints PASS/FAIL lines with ids and amounts only (the Actions log is public). Never prints a secret.
//
//   APP_URL=… CRON_SECRET=… INVITE_CODE=… node scripts/staging-trade-check.mjs
import { randomBytes } from 'node:crypto';

const BASE = process.env.APP_URL;
const CRON = process.env.CRON_SECRET;
const INVITE = process.env.INVITE_CODE;
if (!BASE || !CRON || !INVITE) { console.error('APP_URL, CRON_SECRET and INVITE_CODE are required'); process.exit(2); }

const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const credits = (c) => (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (c) => '$' + credits(c);

// The market maker's math (same formulas as lib/next-market.ts), to check what the panel shows.
const feeOf = (amt) => Math.ceil((amt * 50) / 10_000);
function buyShares(p, net, depth) { const k = 1 / depth; return Math.floor((-Math.expm1(-k * net * (1 - 1e-12)) / (k * p)) * 1e9) / 1e9; }
function sellProceeds(p, s, depth) { const k = 1 / depth; return Math.max(0, Math.floor((Math.log1p(k * p * s) / k) * (1 - 1e-9))); }
function sharesForCredits(p, c, depth) { const k = 1 / depth; return Math.ceil((Math.expm1(k * c) / (k * p)) * 1e9) / 1e9; }

const admin = async (path, method = 'GET') => {
  const r = await fetch(BASE + path, { method, headers: { 'x-cron-secret': CRON } });
  return { status: r.status, body: await r.json().catch(() => null) };
};
let cookie = '';
const asPlayer = async (path, opts = {}) => {
  const r = await fetch(BASE + path, { ...opts, headers: { ...(opts.headers ?? {}), ...(cookie ? { cookie } : {}), 'content-type': 'application/json' }, redirect: 'manual' });
  const set = r.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
  return r;
};
const text = (html) => html.replace(/<!-- -->/g, '').replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const artistRow = async (id) => (await admin('/api/admin/market')).body.overview.artists.find((a) => a.id === id);

(async () => {
  // --- 1. reconciliation before anything ---
  let r = await admin('/api/admin/market/reconcile', 'POST');
  check('reconciliation endpoint reachable with staging credentials', r.status === 200 || r.status === 409, `HTTP ${r.status}`);
  if (!r.body) { console.log('No response body; stopping.'); process.exit(1); }
  const before = r.body;
  const issueList = (rep) => rep.issues.map((i) => `${i.check}${i.artistId != null ? `@artist ${i.artistId}` : ''}${i.userId != null ? `@user ${i.userId}` : ''}`).join(', ');
  check('every account balance matches its ledger account', !before.issues.some((i) => i.check === 'player_balance_matches_ledger' || i.check === 'deleted_accounts_retired'));
  check('every artist reserve covers everything its holders could be paid', !before.issues.some((i) => i.check === 'reserve_covers_holders' || i.check === 'reserve_matches_ledger'));
  check('every ledger entry balances', !before.issues.some((i) => i.check === 'entry_balances'));
  check('holdings match the market maker (shares held + retired = shares outstanding; none negative)', !before.issues.some((i) => i.check === 'shares_held_match_curve' || i.check === 'no_negative_holdings'));
  check('no Credits created or lost: players + reserves + fees + retired = issued + opening reserves + liquidity', !before.issues.some((i) => i.check === 'credits_conserved'),
    `players ${credits(before.totals.playersCents)} + reserves ${credits(before.totals.reservesCents)} + fees ${credits(before.totals.feePoolCents)} + retired ${credits(before.totals.retiredCents)} = issued ${credits(before.totals.issuedCents)} + opening ${credits(before.totals.openingReserveCents)} + liquidity ${credits(before.totals.liquidityAddedCents)}`);
  check('no unresolved accounting issues', before.ok === true && before.issues.length === 0, before.issues.length ? issueList(before) : `${before.checked.users} accounts, ${before.checked.artists} artists, ${before.checked.ledgerEntries} ledger entries checked`);
  const m = before.migration;
  check('migration proof: balances, holdings, reserves and history preserved', m && m.ok === true,
    m ? `${m.balances.players} balances in ledger unchanged: ${m.balances.ledgerOpenedWithSameBalances}; ${m.holdings.count} holdings, ${m.holdings.holdingsWhoseValueChanged} changed value; ${m.reserves.artistsFunded} reserves covering ${credits(m.reserves.owedAtMigrationCents)}: ${m.reserves.everyReserveCovered}; trades ${m.history.transactionsAtMigration}→${m.history.transactionsNow}, price points ${m.history.priceHistoryAtMigration}→${m.history.priceHistoryNow}` : 'missing');

  // --- 2. authenticated trade ---
  const tag = randomBytes(4).toString('hex');
  const email = `phase1-staging-check-${tag}@example.com`;
  const res = await asPlayer('/api/auth/signup', { method: 'POST', body: JSON.stringify({ name: `Phase 1 staging check ${tag}`, email, password: randomBytes(18).toString('base64url'), tosAccepted: true, privacyAccepted: true, inviteCode: INVITE }) });
  const me = await res.json().catch(() => ({}));
  check('a labelled staging test account signs up with an authorized invite', res.status === 201 && me.next_credits_cents === 1_000_000, `HTTP ${res.status}, account #${me.id}`);
  if (res.status !== 201) process.exit(1);
  await asPlayer('/api/next/onboarding/complete', { method: 'POST' });

  const overview = (await admin('/api/admin/market')).body.overview;
  const candidates = overview.artists.filter((a) => a.priceCents != null && !a.haltedAt).sort((a, b) => a.holders - b.holders);
  let artist = null, buy = null;
  for (const a of candidates.slice(0, 10)) {
    const page = text(await (await asPlayer(`/next/artists/${a.id}`)).text());
    if (!/Review purchase/.test(page)) continue;
    artist = { ...a, page };
    break;
  }
  check('an artist trading panel opens for the signed-in player', artist, artist ? `artist #${artist.id}, price ${money(artist.priceCents)}, depth ${credits(artist.depthCents)}` : 'none found');
  if (!artist) process.exit(1);
  const P = artist.priceCents, D = artist.depthCents;
  const ask = 10_000 / buyShares(P, 10_000 - feeOf(10_000), D);
  const bidShares = sharesForCredits(P, 10_000, D);
  const bid = sellProceeds(P, bidShares, D) / bidShares;
  const fmt = (c) => '$' + (c / 100).toFixed(2);
  const shown = (side) => (artist.page.match(new RegExp(`${side} 100 Credits: (\\$[0-9,.]+) ?/share`)) ?? [])[1];
  check('the panel shows buy and sell quotes for 100 Credits, matching the market maker', shown('Buy') === fmt(ask) && shown('Sell') === fmt(bid),
    `shown buy ${shown('Buy')} / sell ${shown('Sell')}; expected ${fmt(ask)} / ${fmt(bid)}`);
  check('before confirming, the panel shows the 0.5% purchase fee for 100 Credits', /Trading fee \(0\.5%\) \$0\.50/.test(artist.page) && /Goes into the market \$99\.50/.test(artist.page));
  check('the panel names the market maker and says Credits have no cash value', /NEXT market maker/.test(artist.page) && /no cash value/.test(artist.page));
  check('the panel shows the starting balance', /Balance \$10,000\.00/.test(artist.page));

  const pre = await artistRow(artist.id);
  const reconPre = (await admin('/api/admin/market/reconcile', 'POST')).body;
  r = await asPlayer(`/api/next/artists/${artist.id}/trade`, { method: 'POST', body: JSON.stringify({ type: 'buy', credits_amount_cents: 10_000, quotedPriceCents: pre.priceCents, idempotencyKey: `staging-check-buy-${tag}` }) });
  buy = await r.json();
  const expectedShares = buyShares(pre.priceCents, 9_950, pre.depthCents);
  check('a 100-Credit purchase fills', r.status === 200 && buy.ok, `HTTP ${r.status}${buy.error ? ': ' + buy.error : ''}`);
  if (!buy.ok) process.exit(1);
  check('fee 0.50 charged; balance 10,000 → 9,900.00', buy.feeCents === 50 && buy.newBalanceCents === 990_000, `fee ${money(buy.feeCents)}, balance ${money(buy.newBalanceCents)}`);
  check('shares received match the curve exactly', Math.abs(buy.shares - expectedShares) < 1e-9, `${buy.shares} shares (expected ${expectedShares})`);
  const mid = await artistRow(artist.id);
  check('the artist reserve rose by exactly the 99.50 that went into the market', mid.reserveCents - pre.reserveCents === 9_950, `${money(pre.reserveCents)} → ${money(mid.reserveCents)}`);
  check('the reserve still covers every holder', mid.marginCents >= 0, `margin ${money(mid.marginCents)}`);
  const reconMid = (await admin('/api/admin/market/reconcile', 'POST')).body;
  check('ledger: players −100.00, reserves +99.50, fee pool +0.50, and the books balance',
    reconMid.ok && reconMid.totals.playersCents - reconPre.totals.playersCents === -10_000 && reconMid.totals.reservesCents - reconPre.totals.reservesCents === 9_950 && reconMid.totals.feePoolCents - reconPre.totals.feePoolCents === 50,
    reconMid.ok ? '' : issueList(reconMid));
  const midPage = text(await (await asPlayer(`/next/artists/${artist.id}`)).text());
  check('the panel shows the new balance and the holding', /Balance \$9,900\.00/.test(midPage) && new RegExp(`Shares owned ${buy.shares.toFixed(4)}`).test(midPage));

  r = await asPlayer(`/api/next/artists/${artist.id}/trade`, { method: 'POST', body: JSON.stringify({ type: 'sell', credits_amount_cents: 999_999_999_999, quotedPriceCents: mid.priceCents, idempotencyKey: `staging-check-sell-${tag}` }) });
  const sell = await r.json();
  check('selling the whole holding fills, with no fee', r.status === 200 && sell.ok && sell.feeCents === 0, `HTTP ${r.status}${sell.error ? ': ' + sell.error : ''}`);
  const proceeds = sell.newBalanceCents - 990_000;
  const expectedProceeds = sellProceeds(mid.priceCents, buy.shares, mid.depthCents);
  check('the sale paid exactly the curve amount, and the round trip cost the fee plus rounding only',
    proceeds === expectedProceeds && proceeds <= 9_950 && proceeds >= 9_940, `paid ${money(proceeds)}; final balance ${money(sell.newBalanceCents)} (started ${money(1_000_000)})`);
  const post = await artistRow(artist.id);
  check('the price returned to where it was before the purchase', Math.abs(post.priceCents / pre.priceCents - 1) < 1e-9, `${pre.priceCents} → ${post.priceCents} cents`);
  check('the reserve kept only the rounding (never less than before)', post.reserveCents - pre.reserveCents === 9_950 - proceeds && post.reserveCents >= pre.reserveCents, `${money(pre.reserveCents)} → ${money(post.reserveCents)}`);
  const endPage = text(await (await asPlayer(`/next/artists/${artist.id}`)).text());
  check('the panel shows the final balance and no remaining holding', endPage.includes(`Balance ${money(sell.newBalanceCents)}`) && !/Shares owned/.test(endPage));

  // --- 3. reconciliation after ---
  const after = (await admin('/api/admin/market/reconcile', 'POST')).body;
  check('reconciliation after the trades: every check passes', after.ok === true && after.issues.length === 0, after.ok ? `${after.checked.users} accounts, ${after.checked.ledgerEntries} ledger entries` : issueList(after));
  check('Credits conserved across the test: issued grew by exactly the new account\'s 10,000',
    after.totals.issuedCents - before.totals.issuedCents === 1_000_000
    && after.totals.playersCents + after.totals.reservesCents + after.totals.feePoolCents + after.totals.retiredCents === after.totals.issuedCents + after.totals.openingReserveCents + after.totals.liquidityAddedCents);

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed · test account #${me.id} (kept on staging so its trades stay visible) · artist #${artist.id}`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error('check crashed:', e?.message ?? e); process.exit(1); });
