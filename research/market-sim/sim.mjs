// Market simulation: NEXT's CURRENT engine (the app's real lib/next-market.ts functions with executeTrade's
// exact rules) versus the PROPOSED transparent market maker (an exponential bonding curve per artist with a
// disclosed fee). Read-only research: nothing in the app is changed.
//
//   node --experimental-strip-types --no-warnings research/market-sim/sim.mjs [--users 10,100,1000,10000] [--days 60]
//
// Every number here is simulated; no real player or artist is involved. Agents are deliberately simple
// (preference-driven buyers, momentum followers, profit-takers) — the point is to stress the pricing and
// accounting rules, not to forecast real behaviour.
import { applyTradeImpact, executionPriceCents, quoteSell, nextBasePriceCents } from '../../lib/next-market.ts';

const argv = process.argv.slice(2);
const arg = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const USERS = arg('--users', '10,100,1000,10000').split(',').map(Number);
const DEPTH_PER_PLAYER = Number(arg('--depth-per-player', '0'));   // proposed: market depth grows with the player base (disclosed)
const DAYS = Number(arg('--days', '60'));
const QUIET = [20 * 24, 30 * 24];                 // days 20–30: nobody trades at all
const ARTISTS = 40, START = 1_000_000;            // $10,000 virtual Credits per player (NEXT_STARTING_CREDITS_CENTS)

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function gauss(r) { return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()); }

// ---------------------------------------------------------------- the two pricing engines
// Each engine keeps per-artist state and exposes buy(a, credits) -> {shares, cost} and sell(a, shares) -> proceeds.
function currentEngine(listings) {
  const price = listings.slice();
  return {
    name: 'current',
    price: (a) => price[a],
    buy(a, cents) {                                  // lib/db.ts executeTrade 'buy'
      const post = applyTradeImpact(price[a], cents, 'buy'); const exec = executionPriceCents(price[a], post);
      price[a] = post; return { shares: cents / exec, cost: cents };
    },
    sell(a, shares) {                                // executeTrade 'sell' of a known share count (quoteSell)
      const q = quoteSell(price[a], shares); price[a] = q.postPriceCents; return q.proceedsCents;
    },
    exitValue: (a, shares) => quoteSell(price[a], shares).proceedsCents,   // what the app marks a holding at
    reserve: () => null,
  };
}
// Proposed: P(q) = P0·e^(q/L), cost to move q1→q2 = P0·L·(e^(q2/L) − e^(q1/L)). Path-independent, so a round trip can
// never profit; a disclosed fee on each side is burned (a credit sink); credits round against the trader.
function curveEngine(listings, { depthCents = 20_000_000, fee = 0.005 } = {}) {
  const P0 = listings.slice(), L = P0.map((p) => depthCents / p);    // depth: $200,000 at listing ⇒ a $10,000 buy moves ~5%
  const q = P0.map(() => 0); let reserve = 0, burned = 0;
  const P = (a, qq = q[a]) => P0[a] * Math.exp(qq / L[a]);
  return {
    name: 'curve',
    price: (a) => P(a),
    buy(a, cents) {
      const net = cents / (1 + fee); const f = cents - net;
      const q2 = L[a] * Math.log(Math.exp(q[a] / L[a]) + net / (P0[a] * L[a]));
      const shares = q2 - q[a]; q[a] = q2; reserve += net; burned += f;
      return { shares, cost: cents };
    },
    sell(a, shares) {
      shares = Math.min(shares, q[a]);
      const gross = P0[a] * L[a] * (Math.exp(q[a] / L[a]) - Math.exp((q[a] - shares) / L[a]));
      const proceeds = Math.floor(gross * (1 - fee)); q[a] -= shares; reserve -= gross; burned += gross - proceeds;
      return proceeds;
    },
    exitValue(a, shares) { const g = P0[a] * L[a] * (Math.exp(q[a] / L[a]) - Math.exp((q[a] - Math.min(shares, q[a])) / L[a])); return Math.floor(g * (1 - fee)); },
    reserve: () => ({ reserve, burned, owed: P0.reduce((s, p0, a) => s + p0 * L[a] * (Math.exp(q[a] / L[a]) - 1), 0) }),
    quote(a, cents = 10_000) {                        // the live bid/ask for a $100 trade, from the curve alone
      const net = cents / (1 + fee); const q2 = L[a] * Math.log(Math.exp(q[a] / L[a]) + net / (P0[a] * L[a]));
      const ask = cents / (q2 - q[a]);
      const s = Math.min(q[a], cents / P(a)); const bid = s > 0 ? this.exitValue(a, s) / s : null;
      return { bid, ask };
    },
  };
}

// ---------------------------------------------------------------- one simulated market
function simulate(nUsers, makeEngine, seed = 7) {
  const r = rng(seed);
  const listings = Array.from({ length: ARTISTS }, () => nextBasePriceCents(45 + 45 * r()));
  const E = makeEngine(listings);
  const appeal = Array.from({ length: ARTISTS }, () => gauss(r));
  const users = Array.from({ length: nUsers }, () => {
    const w = appeal.map((a) => Math.exp(a + gauss(r))); const tot = w.reduce((s, x) => s + x, 0);
    let c = 0; const cdf = w.map((x) => (c += x / tot));
    return { credits: START, hold: new Map(), cost: new Map(), cdf, momentum: r() < 0.2, activity: 0.01 + 0.04 * r() };
  });
  const H = DAYS * 24, hist = Array.from({ length: ARTISTS }, () => []);
  let trades = 0, volume = 0, invariantErrors = 0, minPrice = Infinity, maxPrice = 0, quietMoves = 0;
  for (let h = 0; h < H; h++) {
    const quiet = h >= QUIET[0] && h < QUIET[1];
    const before = quiet ? Array.from({ length: ARTISTS }, (_, a) => E.price(a)) : null;
    if (!quiet) for (const u of users) {
      if (r() > u.activity) continue;
      const held = [...u.hold.keys()];
      if (held.length && r() < 0.4) {                                   // take profit / cut a position
        const a = held[Math.floor(r() * held.length)]; const s = u.hold.get(a) * (r() < 0.5 ? 1 : 0.25 + 0.5 * r());
        const p = E.sell(a, s); const rem = u.hold.get(a) - s;
        u.cost.set(a, u.cost.get(a) * (rem / u.hold.get(a)));
        if (rem < 1e-4) { u.hold.delete(a); u.cost.delete(a); } else u.hold.set(a, rem);
        u.credits += p; trades++; volume += p;
      } else {
        let a;
        if (u.momentum && h > 24) {                                      // follow the biggest 24 h riser
          let best = -Infinity; for (let j = 0; j < ARTISTS; j++) { const g = E.price(j) / (hist[j][h - 24] ?? E.price(j)); if (g > best) { best = g; a = j; } }
        } else { const x = r(); a = u.cdf.findIndex((c) => c >= x); if (a < 0) a = ARTISTS - 1; }
        const cents = Math.floor(u.credits * (0.02 + 0.13 * r()));
        if (cents < 2_500) continue;                                     // ignore dust (< $25)
        const { shares } = E.buy(a, cents);
        u.credits -= cents; u.hold.set(a, (u.hold.get(a) ?? 0) + shares); u.cost.set(a, (u.cost.get(a) ?? 0) + cents);
        trades++; volume += cents;
      }
      if (u.credits < 0) invariantErrors++;
    }
    for (let a = 0; a < ARTISTS; a++) {
      const p = E.price(a); hist[a][h] = p; minPrice = Math.min(minPrice, p); maxPrice = Math.max(maxPrice, p);
      if (!Number.isFinite(p) || p <= 0) invariantErrors++;
      if (quiet && p !== before[a]) quietMoves++;
    }
  }
  // portfolio accuracy: what the app would show vs what selling actually returns
  let marked = 0, exitQuoted = 0, credits = 0;
  for (const u of users) { credits += u.credits; for (const [a, s] of u.hold) { marked += s * E.price(a); exitQuoted += E.exitValue(a, s); } }
  const preLiquidation = E.reserve();
  // everyone sells everything, in random order: the realizable total
  const order = users.map((u, i) => i).sort(() => r() - 0.5); let realized = 0;
  for (const i of order) for (const [a, s] of users[i].hold) realized += E.sell(a, s);
  const finalCredits = credits + realized, initial = START * nUsers;
  const dailyMoves = [];
  for (let a = 0; a < ARTISTS; a++) for (let d = 1; d < DAYS; d++) { const p0 = hist[a][(d - 1) * 24], p1 = hist[a][d * 24]; if (p0) dailyMoves.push(Math.abs(p1 / p0 - 1)); }
  dailyMoves.sort((x, y) => x - y);
  const flatHours = hist.reduce((s, ph) => s + ph.filter((p, i) => i > 0 && p === ph[i - 1]).length, 0) / (ARTISTS * (H - 1));
  return {
    engine: E.name, users: nUsers, trades, volume, invariantErrors, quietMoves,
    priceRange: [minPrice / 100, maxPrice / 100], medianDailyMovePct: 100 * dailyMoves[Math.floor(dailyMoves.length / 2)],
    p95DailyMovePct: 100 * dailyMoves[Math.floor(dailyMoves.length * 0.95)], flatHourPct: 100 * flatHours,
    markedVsRealizablePct: marked ? 100 * (marked / realized - 1) : 0, exitQuotesVsRealizablePct: exitQuoted ? 100 * (exitQuoted / realized - 1) : 0,
    creditsCreatedPct: 100 * (finalCredits / initial - 1), reserve: preLiquidation,
  };
}

const fmt = (x, d = 1) => (typeof x === 'number' ? x.toFixed(d) : x);
console.log(`NEXT market simulation: ${ARTISTS} artists, ${DAYS} days (hourly), nobody trades on days 20–30. Every figure is simulated.`);
console.log('engine | players | trades | price range ($) | median / 95th pct daily move | hours with no price change | quiet-period moves | app-marked value vs realizable | exit quotes vs realizable | credits created (+) or destroyed (−) | invariant errors');
for (const n of USERS) {
  const depth = Math.max(20_000_000, DEPTH_PER_PLAYER * 100 * n);
  for (const mk of [currentEngine, (l) => curveEngine(l, { depthCents: depth })]) {
    const t0 = Date.now(); const s = simulate(n, mk);
    console.log([s.engine, n, s.trades, `${fmt(s.priceRange[0], 2)}–${fmt(s.priceRange[1], 2)}`, `${fmt(s.medianDailyMovePct, 2)}% / ${fmt(s.p95DailyMovePct, 1)}%`,
                 `${fmt(s.flatHourPct)}%`, s.quietMoves, `${s.markedVsRealizablePct >= 0 ? '+' : ''}${fmt(s.markedVsRealizablePct)}%`,
                 `${s.exitQuotesVsRealizablePct >= 0 ? '+' : ''}${fmt(s.exitQuotesVsRealizablePct)}%`, `${s.creditsCreatedPct >= 0 ? '+' : ''}${fmt(s.creditsCreatedPct, 3)}%`,
                 s.invariantErrors, `(${((Date.now() - t0) / 1000).toFixed(1)} s)`].join(' | '));
    if (s.reserve) console.log(`      curve depth $${(depth / 100).toLocaleString()} per artist; solvency before liquidation: reserve $${fmt(s.reserve.reserve / 100, 2)} = owed to holders $${fmt(s.reserve.owed / 100, 2)}; fees burned $${fmt(s.reserve.burned / 100, 2)}`);
  }
}
