// THE MOVE: the illustrative trade, solved against NEXT's own trading rules (lib/next-market.ts and
// executeTrade in lib/db.ts; read-only, nothing in the app is changed). This file only mirrors the
// arithmetic to *choose* amounts; capture_move.js then executes every trade through the real app on
// a local demo database and checks that the app's own numbers match these, to the cent.
//
//   Buy:  post = round(pre * (1 + 0.05 * amount / $10,000)); fill = round((pre + post) / 2);
//         shares = amount / fill
//   Sell: notional = round(shares * pre); post = round(pre * (1 - 0.05 * notional / $10,000));
//         fill = round((pre + post) / 2); proceeds = round(shares * fill);
//         realized P&L = round(proceeds - cost basis of the shares sold)
//   Price floor $1.00. All money in integer cents.
const jsRound = Math.round;
const MIN = 100, PER = 1_000_000, RATE = 0.05;
const impact = (c) => (c / PER) * RATE;
const applyImpact = (p, c, dir) => Math.max(MIN, jsRound(p * (dir === 'buy' ? 1 + impact(c) : 1 - impact(c))));
const execPrice = (a, b) => Math.max(MIN, jsRound((a + b) / 2));
function buy(p, c) { const post = applyImpact(p, c, 'buy'); const fill = execPrice(p, post); return { post, fill, shares: c / fill }; }
function quoteSell(p, shares) {
  const notional = jsRound(shares * p); const post = applyImpact(p, notional, 'sell'); const fill = execPrice(p, post);
  return { post, fill, proceeds: jsRound(shares * fill) };
}
function sellAll(p, shares, cost) { const q = quoteSell(p, shares); return { ...q, pnl: jsRound(q.proceeds - (cost / shares) * shares) }; }

// The one exit price (integer cents) at which selling the whole position realizes exactly `target`.
function exitPriceFor(shares, cost, target, lo, hi) {
  for (let c = lo; c <= hi; c++) if (sellAll(c, shares, cost).pnl === target) return c;
  return null;
}
// The market after the pick: the crowd's trades in order; the last buy is sized (whole dollars) so the
// price lands exactly on `exit`.
function landOn(p, crowd, exit) {
  for (const [dir, c] of crowd) p = dir === 'buy' ? buy(p, c).post : quoteSell(p, c / p).post;   // sells here are by amount
  for (let d = 1500; d <= 6000; d++) if (buy(p, d * 100).post === exit) return { before: p, last: d * 100 };
  return null;
}
// Solve: given the listing price, choose the pick size (preferring round amounts) and the crowd's last buy.
// The pick is the first trade on the artist (the earliest possible pick). The artist's listing price comes
// from the scouts' rating (nextBasePriceCents(breakoutScore)), in 0.5-point score steps; a score of 62.5
// lists at $22.03, where a $4,500 pick can realize exactly +$1,432.00 (searched over scores 40–80 and
// picks of $2,000–$6,000: see README).
function solve(listing, target = 143_200, crowd, picks = [4500]) {
  for (const dollars of picks) {
    for (const pre of [0]) {
      const p0 = pre ? buy(listing, pre * 100).post : listing;
      const B = dollars * 100; const b = buy(p0, B);
      const exit = exitPriceFor(b.shares, B, target, b.post, b.post * 3);
      if (exit == null) continue;
      const land = landOn(b.post, crowd, exit);
      if (land) return { listing, earlyBacker: pre * 100, priceAtPick: p0, pick: B, pickFill: b.fill, shares: b.shares, afterPick: b.post,
                         exit, crowdBeforeLast: land.before, lastBuy: land.last, sale: sellAll(exit, b.shares, B) };
    }
  }
  return null;
}
// The crowd after the pick (demo players; [side, credits in cents]); solve() sizes one more buy at the end.
const CROWD = [['buy', 420000], ['buy', 380000], ['buy', 510000], ['sell', 60000], ['buy', 450000], ['buy', 600000],
               ['buy', 350000], ['buy', 480000], ['sell', 90000], ['buy', 520000], ['buy', 400000], ['buy', 450000], ['buy', 380000], ['buy', 420000]];
module.exports = { buy, quoteSell, sellAll, solve, applyImpact, CROWD };
if (require.main === module) {
  const listing = Number(process.argv[2] || 2203);
  const crowd = CROWD;
  console.log(JSON.stringify(solve(listing, 143_200, crowd), null, 1));
}
