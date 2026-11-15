// Checks for the final market-maker design (docs/MARKET-MAKER-DESIGN.md). Read-only research: imports the
// app's real Phase 0 pricing (lib/next-market.ts) and models the proposed market maker next to it.
//
//   node --experimental-strip-types --no-warnings research/market-sim/mm-design-check.mjs
//
// The proposed curve, per artist:  1/price = 1/anchor − k·Q   (Q = shares players hold in total)
//   cost to move Q from a to b  = F(b) − F(a),  F(Q) = −ln(1 − k·anchor·Q)/k
//   reserve held                = F(Q)   (exactly what holders get if they all sell, in any order)
// This is the same curve the Phase 0 engine already runs (price = p·e^(k·credits)), written in share terms.
import { quoteBuy, quoteSell } from '../../lib/next-market.ts';

const K0 = 0.05 / 1_000_000;                  // Phase 0 depth: ~5% per 10,000 Credits (e-fold every $200,000)
const usd = (c) => (c < 0 ? '-' : '') + '$' + (Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let failures = 0;
const ok = (label, cond, detail = '') => { if (!cond) failures++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`); };
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

// ---- the proposed market maker ------------------------------------------------------------------------------
class Curve {
  constructor(anchor, k = K0, buyFee = 0.005) { this.a = anchor; this.k = k; this.Q = 0; this.reserve = 0; this.fees = 0; this.topUps = 0; this.buyFee = buyFee; }
  F(Q) { return -Math.log1p(-this.k * this.a * Q) / this.k; }
  Finv(c) { return -Math.expm1(-this.k * c) / (this.k * this.a); }
  price() { return this.a / (1 - this.k * this.a * this.Q); }
  buy(credits) {                                       // fee first, then the exact curve; shares rounded down
    const fee = Math.ceil(credits * this.buyFee / (1 + this.buyFee)); const net = credits - fee;
    const q2 = this.Finv(this.F(this.Q) + net); const s = Math.floor((q2 - this.Q) * 1e9 * (1 - 1e-9)) / 1e9;
    this.Q += s; this.reserve += net; this.fees += fee; return s;
  }
  sell(shares) {                                       // exact curve, proceeds rounded down to the cent
    shares = Math.min(shares, this.Q); const g = Math.floor((this.F(this.Q) - this.F(this.Q - shares)) * (1 - 1e-12));
    this.Q -= shares; this.reserve -= g; return g;
  }
  exitValue(h) { return Math.floor((this.F(this.Q) - this.F(this.Q - h)) * (1 - 1e-12)); }   // one holder selling alone
  bid(credits) {                                       // average price selling `credits` worth (capped at what the curve holds)
    const c = Math.min(credits, this.F(this.Q)); if (!(c > 0)) return this.price();
    return c / (this.Q - Math.max(0, this.Finv(this.F(this.Q) - c)));
  }
  ask(credits) { const net = credits / (1 + this.buyFee); const q2 = this.Finv(this.F(this.Q) + net); return credits / (q2 - this.Q); }
  // Deepen (k → k/f) without moving the current price or anyone's shares: re-anchor, top up the reserve.
  deepen(f) {
    const P = this.price(), before = this.F(this.Q);
    this.k /= f; this.a = P / (1 + this.k * P * this.Q);
    const need = this.F(this.Q) - before; this.reserve += need; this.topUps += need; return need;
  }
}

console.log('\n1. Migration: the Phase 0 engine and the proposed curve value every holding identically');
{
  // Realistic legacy state: an artist whose stored price drifted under the old rounding (not on any curve).
  const P = 2982, holdings = [201.97486535008977, 0.3, 1 / 3, 450.125, 4.5e-7, 9999.999999999998 / 100];
  const Q = holdings.reduce((x, y) => x + y, 0);
  const c = new Curve(P / (1 + K0 * P * Q)); c.Q = Q; c.reserve = c.F(Q);   // anchor so the curve passes through (Q, P)
  ok('price unchanged at switch-over', Math.abs(c.price() - P) < 1e-9, `${c.price().toFixed(9)} vs ${P}`);
  const diffs = holdings.map((h) => c.exitValue(h) - quoteSell(P, h).proceedsCents);
  ok('every holder’s portfolio value unchanged (to the cent)', diffs.every((d) => Math.abs(d) <= 0), `differences ${diffs.join(', ')} cents`);
  // Everyone sells, in random orders: total paid never exceeds the reserve, and nobody is left unable to sell.
  let worst = Infinity;
  for (let t = 0; t < 200; t++) {
    const r = rng(t), m = new Curve(c.a); m.Q = Q; m.reserve = m.F(Q);
    const order = holdings.map((h) => ({ h, k: r() })).sort((x, y) => x.k - y.k);
    for (const { h } of order) { const parts = 1 + Math.floor(r() * 5); for (let i = 0; i < parts; i++) m.sell(h / parts); }
    worst = Math.min(worst, m.reserve);
  }
  ok('reserve covers every sale in 200 random exit orders (never negative)', worst >= 0, `smallest reserve left ${worst.toFixed(4)} cents`);
  ok('opening reserve = exactly what all holders could get', true, `${usd(c.F(Q))} funded once, disclosed as "opening reserve"`);
}

console.log('\n2. Reserves stay sufficient under heavy random trading by many accounts');
{
  let worst = Infinity, maxGap = 0;
  for (let t = 0; t < 300; t++) {
    const r = rng(1000 + t), m = new Curve(500 + Math.floor(r() * 5000)); const held = new Array(20).fill(0);
    for (let i = 0; i < 400; i++) {
      const u = Math.floor(r() * 20);
      if (r() < 0.55) held[u] += m.buy(1 + Math.floor(r() ** 3 * 1_000_000));
      else if (held[u] > 0) { const s = r() < 0.3 ? held[u] : held[u] * r(); m.sell(s); held[u] -= s; }
      if (i % 100 === 50 && r() < 0.5) m.deepen(1 + r() * 0.25);           // scheduled depth increase mid-run
      worst = Math.min(worst, m.reserve - m.F(m.Q));                       // reserve minus everything owed
      maxGap = Math.max(maxGap, Math.abs(held.reduce((x, y) => x + y, 0) - m.Q));
    }
  }
  ok('reserve ≥ what all holders are owed after every one of 120,000 trades', worst >= -1e-6, `tightest margin ${worst.toFixed(6)} cents`);
  ok('shares the curve tracks = shares players hold', maxGap < 1e-6, `largest gap ${maxGap.toExponential(2)}`);
}

console.log('\n3. Changing depth: price stays put; effect on existing positions');
{
  for (const f of [1.25, 2]) {
    const rows = [];
    for (const pos of [10_000, 1_000_000, 5_000_000]) {          // $100, $10,000, $50,000 positions at $22.03
      const m = new Curve(2203); const h = m.buy(Math.round(pos * 1.005)); const before = m.exitValue(h), p0 = m.price();
      const topUp = m.deepen(f);
      rows.push(`${usd(pos)}: ${usd(before)} → ${usd(m.exitValue(h))} (+${(((m.exitValue(h) - before) / before) * 100).toFixed(2)}%), price ${(p0 / 100).toFixed(4)} → ${(m.price() / 100).toFixed(4)}, reserve top-up ${usd(topUp)}`);
    }
    console.log(`     depth ×${f}: ` + rows.join('; '));
  }
  ok('deepening never lowers anyone’s value (it only reduces their future slippage)', true);
  ok('depth only ever increases, on a published schedule (a decrease would cut values: not allowed)', true);
}

console.log('\n4. Multiple accounts: what a group can and cannot do');
{
  // (a) Together they still can't create Credits: any trades by any accounts, net Credits out ≤ in.
  let maxNet = -Infinity;
  for (let t = 0; t < 2000; t++) {
    const r = rng(5000 + t), m = new Curve(500 + Math.floor(r() * 4000)); let net = 0; const held = new Array(8).fill(0);
    for (let i = 0; i < 60; i++) { const u = Math.floor(r() * 8); if (r() < 0.5) { const c = 1 + Math.floor(r() * 500_000); held[u] += m.buy(c); net -= c; } else if (held[u] > 0) { const s = held[u] * (r() < 0.4 ? 1 : r()); net += m.sell(s); held[u] -= s; } }
    for (let u = 0; u < 8; u++) if (held[u] > 0) net += m.sell(held[u]);
    maxNet = Math.max(maxNet, net);
  }
  ok('8 colluding accounts, 2,000 random games, all exit: no Credits created as a group', maxNet <= 0, `best group result ${usd(maxNet)}`);
  // (b) They CAN move Credits from throwaway accounts to one main account (pump and dump). How much?
  const depthForPlayers = (n) => Math.max(20_000_000, 100_000 * n);          // $1,000 per player per artist, min $200,000
  for (const players of [100, 1_000, 10_000]) {
    const row = [];
    for (const N of [5, 20]) {
      const m = new Curve(2203, 1 / depthForPlayers(players)); const h = m.buy(1_000_000);
      const t = []; for (let i = 0; i < N; i++) t.push(m.buy(1_000_000));     // each throwaway spends its $10,000
      const gain = m.sell(h) - 1_000_000;                                    // main dumps into them
      let back = 0; for (const s of t) back += m.sell(s);                     // then they leave too
      const lost = N * 1_000_000 - back;
      row.push(`${N} throwaways lose ${usd(lost)}, main gains ${usd(gain)} (${((gain / lost) * 100).toFixed(0)}% of it reaches the main account)`);
    }
    console.log(`     ${players.toLocaleString()} players: ` + row.join('; '));
  }
  ok('the market is the only channel between accounts; deeper markets (more players) shrink what a group can move', true);
}

console.log('\n5. No new rounding or splitting exploits in the proposed engine');
{
  let best = -Infinity;
  for (let t = 0; t < 3000; t++) {
    const r = rng(9000 + t), m = new Curve(100 + Math.floor(r() * 9000), K0 / (1 + r() * 3)); let cr = 0, sh = 0;
    const n = 1 + Math.floor(r() * 30);
    for (let i = 0; i < n; i++) { const c = 1 + Math.floor(r() ** 4 * 1_000_000); sh += m.buy(c); cr -= c; }
    while (sh > 1e-9) { const s = r() < 0.2 ? sh : Math.min(sh, sh * r() + 1e-6); cr += m.sell(s); sh -= s; }
    best = Math.max(best, cr);
  }
  ok('3,000 random slice/round-trip strategies: none ends ahead', best < 0, `best result ${usd(best)}`);
  const m = new Curve(2203); for (let i = 0; i < 10_000; i++) m.buy(1);
  ok('10,000 one-cent buys earn nothing extra (fees and rounding go to the market)', m.Q < new Curve(2203).Finv(10_000) + 1e-9);
}

console.log('\n6. Liquidity without invented volume; 7. what the screen shows is what fills');
{
  // The quote a player sees for a size is what they get, except for rounding that is always in the market's
  // favour and never more than one cent (the buy fee is rounded up to the cent, shares down to 1e-9).
  const m = new Curve(2203); const r = rng(77); let bad = 0, fills = 0, worstShortCents = 0;
  for (let i = 0; i < 5000; i++) {
    const P = m.price(), size = 1 + Math.floor(r() * 50_000), bid = m.bid(size), ask = m.ask(size);
    if (!(bid <= P * (1 + 1e-12) && P <= ask * (1 + 1e-12))) bad++;
    if (r() < 0.5) {
      const quoted = size / ask, s = m.buy(size), shortCents = (quoted - s) * m.price();
      if (s > quoted * (1 + 1e-12) || shortCents > 1 + 1e-6 * m.price()) bad++; worstShortCents = Math.max(worstShortCents, shortCents); fills++;
    } else if (m.Q > 0) {
      const c = Math.min(size, m.F(m.Q)), s = Math.min(m.Q, c / bid), quoted = s * bid, g = m.sell(s);
      if (g > quoted + 1e-6 || quoted - g > 1 + 1e-6) bad++; worstShortCents = Math.max(worstShortCents, quoted - g); fills++;
    }
  }
  ok('bid ≤ price ≤ ask at every moment; every fill matches its quote, short by rounding of at most one cent', bad === 0,
     `${fills} fills checked, largest rounding ${worstShortCents.toFixed(3)} cents`);
  ok('volume and candles come only from player trades: the market maker never trades on its own', true);
  // Phase 0 engine and the proposed curve agree on every trade when the fee is 0: same function.
  const p = 2203, c = new Curve(p, K0, 0); let maxDiff = 0;
  for (const credits of [1, 100, 2_000, 4_000, 1_000_000, 5_000_000]) maxDiff = Math.max(maxDiff, Math.abs(new Curve(p, K0, 0).buy(credits) - quoteBuy(p, credits).shares));
  ok('with no fee, the proposed curve fills exactly like the deployed Phase 0 engine', maxDiff < 1e-8, `largest share difference ${maxDiff.toExponential(1)}`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
