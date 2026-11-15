// NEXT's paper-market pricing. Deliberately transparent (no hidden formula) —
// documented here and echoed in the UI, per the "the algorithm has an
// opinion, the market has an opinion, you decide who's right" design.

import type { NextPricePoint } from './types';

// % price change over a rolling window — the "Trending today" sort's own
// math, factored out so DiscoverGrid and the Market Activity page compute
// "biggest movers" identically instead of two slightly different formulas.
// Falls back to the earliest known point when nothing falls inside the
// window (a quiet artist's price hasn't moved recently, not "unknown").
export function changePctForWindow(priceCents: number, priceHistory: NextPricePoint[], hours: number): number {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const inWindow = priceHistory.filter((p) => new Date(p.recorded_at).getTime() >= cutoff);
  const first = inWindow[0]?.price_cents ?? priceHistory[0]?.price_cents ?? priceCents;
  return first !== 0 ? ((priceCents - first) / first) * 100 : 0;
}

// % change since the earliest recorded price — "since this artist joined
// NEXT," the default (non-windowed) reading DiscoverGrid's price sparkline
// and gain/loss sorts use.
export function changePctSinceListing(priceCents: number, priceHistory: NextPricePoint[]): number {
  const first = priceHistory[0]?.price_cents ?? priceCents;
  return first !== 0 ? ((priceCents - first) / first) * 100 : 0;
}

// "Significant move" thresholds shared by ArtistCard's since-you-added
// alert flag and the Notification center's watchlist-move notifications —
// one definition of "significant" instead of two. 5 points is
// momentumStatus()'s own "Rising" cutoff in lib/scoring.ts; 10% has no
// prior precedent in this codebase — a deliberately simple first-pass band.
export const ALERT_SCORE_THRESHOLD = 5;
export const ALERT_PRICE_PCT_THRESHOLD = 10;

export const NEXT_STARTING_CREDITS_CENTS = 1_000_000; // $10,000.00 in NEXT Credits

// "Sell everything" is deliberately requested as an oversized credits
// amount, not an estimated dollar figure — executeTrade's sell branch
// already caps sharesSold at ownedShares (Math.min(requestedShares,
// ownedShares)), same idiom lib/db.test.ts uses throughout to sell out a
// position. Any estimate of "what my shares are worth" derived from a
// live quote can undershoot the true share count by the time the request
// executes (the quote can move, or — as happened here — the estimate can
// legitimately be LESS than shares * quote once it accounts for a sell's
// own price impact), which would silently leave a residue unsold. A huge
// sentinel sidesteps the estimation entirely: it always exceeds any real
// holding, so the server-side cap is what actually decides the amount.
export const SELL_ALL_SENTINEL_CENTS = 999_999_999;

// LEGACY listing price, from the Scout Score: a $1-$50 range, curved so a strong score started higher
// (score 55 -> ~$17.70, score 94 -> ~$44.84, score 100 -> $50.00). Since Phase 1 it applies only to artists
// listed before then (artists.next_listing_rule = 'score'), so their prices never change; every newly listed
// artist starts at NEXT_LISTING_PRICE_CENTS, keeping the Scout rating separate from the market price.
export function nextBasePriceCents(score: number): number {
  const normalized = Math.max(0, Math.min(100, score)) / 100;
  const dollars = 1 + Math.pow(normalized, 1.8) * 49;
  return Math.round(dollars * 100);
}

// ---------------------------------------------------------------------------------------------
// The NEXT market maker (Phase 1). See docs/MARKET-MAKER-DESIGN.md and docs/PHASE-1-REPORT.md.
//
// Every artist has a transparent automated market maker. It is always the other side of a trade, it never
// trades on its own, and every Credit paid into it sits in that artist's reserve. Its rule, per artist:
//
//     1 / price = 1 / anchor − Q / depth        Q = shares held by all players, depth in cents
//
// (the same curve Phase 0 runs: buying B Credits moves the price ×e^(B/depth); ~5% per 10,000 Credits at
// the default depth of 200,000 Credits). Consequences, all exact:
//   • Cost of any move from Q₁ to Q₂ is F(Q₂) − F(Q₁), with F(Q) = −depth·ln(1 − anchor·Q/depth). The
//     result depends only on where the curve starts and ends, so splitting a trade can never help.
//   • What all holders together are owed (selling everything, in any order) is F(Q) = depth·ln(price/anchor).
//     The reserve is kept ≥ that at all times (checked inside every trade and by reconciliation).
//   • The price can never fall below the anchor (where nobody holds a share), so there is no $1 floor.
//   • Buys pay a 0.5% fee (rounded up to the cent) before moving along the curve; sales pay no fee.
//   • Every other fraction rounds in the market's favour: shares down to 1e-9, proceeds down to the cent.
// ---------------------------------------------------------------------------------------------
export const DEFAULT_DEPTH_CENTS = 20_000_000;              // 200,000 Credits: ~5% per 10,000 Credits
export const NEXT_LISTING_PRICE_CENTS = 1_000;              // new artists list at 10 Credits a share
export const BUY_FEE_BPS = 50;                              // 0.5% on purchases; none on sales
export const DEPTH_MAX_STEP = 1.25;                         // depth may rise at most ×1.25 per 7 days
export const DEPTH_STEP_WINDOW_DAYS = 7;
export const DEPTH_CENTS_PER_ACTIVE_TRADER = 100_000;       // recommendation only: 1,000 Credits per trader

// Trading limits (lib/db.ts marketLimits): aimed at throwaway accounts, never at leaving a position.
export const NEW_ACCOUNT_DAYS_DEFAULT = 3;                  // unverified accounts younger than this are "new"
export const NEW_ACCOUNT_DAILY_BUY_PER_ARTIST_CENTS = 250_000; // new accounts: 2,500 Credits of one artist per 24 h
export const DAILY_TRADE_LIMIT = 500;                       // every account: trades per 24 h
export const MIN_BUY_CENTS = 100;                           // smallest purchase: 1 Credit
export const QUOTE_TOLERANCE = 0.02;                        // refuse a fill >2% worse than the quote the player saw

export const SHARE_DECIMALS = 9;
const SHARE_SCALE = 10 ** SHARE_DECIMALS;
const GUARD = 1e-9;                                          // relative guard against floating-point error

// Shares are rounded down to the 1e-9 grid. The floating-point guard is applied to the CREDITS a purchase
// puts in (BUY_GUARD), not to the shares: then the shares any split of a purchase can get are bounded by the
// exact curve amount for the total, which one purchase rounds down to the same grid — so one purchase is
// always at least as good as any split of it, and the curve is never paid less than it gives out.
const BUY_GUARD = 1e-12;
function floorShares(x: number): number { return Math.floor(x * SHARE_SCALE) / SHARE_SCALE; }
function ceilShares(x: number): number { return Math.ceil(x * SHARE_SCALE) / SHARE_SCALE; }
function floorCents(x: number): number { return Math.floor(x * (1 - GUARD)); }
function validDepth(depthCents: number): number { return depthCents > 0 && Number.isFinite(depthCents) ? depthCents : DEFAULT_DEPTH_CENTS; }

// The fee on a purchase of `amountCents` (whole cents, rounded up).
export function buyFeeCents(amountCents: number): number {
  if (!(amountCents > 0)) return 0;
  return Math.ceil((Math.round(amountCents) * BUY_FEE_BPS) / 10_000);
}

// How far the price moves for `creditsAmountCents` going into the curve (as a fraction, e.g. 0.051).
export function priceImpactPct(creditsAmountCents: number, depthCents = DEFAULT_DEPTH_CENTS): number {
  return Math.expm1(creditsAmountCents / validDepth(depthCents));
}

export type BuyQuote = { postPriceCents: number; executionCents: number; shares: number };
export type SellQuote = { postPriceCents: number; executionCents: number; proceedsCents: number };
export type BuyWithFeeQuote = BuyQuote & {
  feeCents: number;          // taken first, goes to the fee pool
  netCents: number;          // what moves along the curve and goes into the reserve
  effectiveCents: number;    // amount paid ÷ shares, fee included
};

// The curve only (no fee): what `creditsCents` going into the curve buys right now. The new price follows
// from the shares actually issued (rounded down), so price and shares held stay exactly on the curve.
export function quoteBuy(currentPriceCents: number, creditsCents: number, depthCents = DEFAULT_DEPTH_CENTS): BuyQuote {
  const p = currentPriceCents, k = 1 / validDepth(depthCents);
  if (!(creditsCents > 0) || !(p > 0)) return { postPriceCents: p, executionCents: p, shares: 0 };
  const shares = floorShares(-Math.expm1(-k * creditsCents * (1 - BUY_GUARD)) / (k * p));
  const postPriceCents = p / (1 - k * p * shares);
  return { postPriceCents, executionCents: shares > 0 ? creditsCents / shares : p, shares };
}

// A purchase as executeTrade runs it: fee first, then the curve.
export function quoteBuyWithFee(currentPriceCents: number, amountCents: number, depthCents = DEFAULT_DEPTH_CENTS): BuyWithFeeQuote {
  const feeCents = buyFeeCents(amountCents);
  const netCents = Math.max(0, Math.round(amountCents) - feeCents);
  const q = quoteBuy(currentPriceCents, netCents, depthCents);
  return { ...q, feeCents, netCents, effectiveCents: q.shares > 0 ? amountCents / q.shares : currentPriceCents };
}

// What selling `shares` right now would net (no fee): the single source of truth for executeTrade's sell
// AND for every portfolio value. Valid because a holder can never sell more than all players hold (Q).
export function quoteSell(currentPriceCents: number, shares: number, depthCents = DEFAULT_DEPTH_CENTS): SellQuote {
  const p = currentPriceCents, k = 1 / validDepth(depthCents);
  if (!(shares > 0) || !(p > 0)) return { postPriceCents: p, executionCents: p, proceedsCents: 0 };
  const proceedsCents = Math.max(0, floorCents(Math.log1p(k * p * shares) / k));
  return { postPriceCents: p / (1 + k * p * shares), executionCents: proceedsCents / shares, proceedsCents };
}

// A holding's value: what selling it alone right now would pay.
export function exitValueCents(currentPriceCents: number, shares: number, depthCents = DEFAULT_DEPTH_CENTS): number {
  return quoteSell(currentPriceCents, shares, depthCents).proceedsCents;
}

// The shares whose sale pays exactly `creditsCents` (rounded up, so the seller gets at least that much,
// capped at what they own by the caller).
export function sharesForSellCredits(currentPriceCents: number, creditsCents: number, depthCents = DEFAULT_DEPTH_CENTS): number {
  const p = currentPriceCents, k = 1 / validDepth(depthCents);
  if (!(creditsCents > 0) || !(p > 0)) return 0;
  return ceilShares(Math.expm1(k * creditsCents) / (k * p));
}

// The price after `creditsAmountCents` traded on one side (buy: credits into the curve; sell: credits paid).
export function applyTradeImpact(priceCents: number, creditsAmountCents: number, direction: 'buy' | 'sell', depthCents = DEFAULT_DEPTH_CENTS): number {
  if (direction === 'buy') return quoteBuy(priceCents, creditsAmountCents, depthCents).postPriceCents;
  return quoteSell(priceCents, sharesForSellCredits(priceCents, creditsAmountCents, depthCents), depthCents).postPriceCents;
}

// The average fill price of a trade that moved the price from pre to post along the curve.
export function executionPriceCents(prePriceCents: number, postPriceCents: number): number {
  if (!(Math.abs(postPriceCents - prePriceCents) > 1e-9 * prePriceCents)) return prePriceCents;
  return (prePriceCents * postPriceCents * Math.log(postPriceCents / prePriceCents)) / (postPriceCents - prePriceCents);
}

// Quotes shown before a trade: the average price per share for buying (fee included) or selling `amountCents`
// worth right now. A sell quote is capped at what the curve holds.
export function askPriceCents(currentPriceCents: number, amountCents: number, depthCents = DEFAULT_DEPTH_CENTS): number {
  return quoteBuyWithFee(currentPriceCents, amountCents, depthCents).effectiveCents;
}
export function bidPriceCents(currentPriceCents: number, amountCents: number, depthCents = DEFAULT_DEPTH_CENTS, maxShares = Infinity): number {
  const s = Math.min(sharesForSellCredits(currentPriceCents, amountCents, depthCents), maxShares);
  return s > 0 ? quoteSell(currentPriceCents, s, depthCents).executionCents : currentPriceCents;
}

// --- curve accounting -------------------------------------------------------------------------
// What all holders together could get by selling everything (in any order): depth·ln(price/anchor).
export function owedCents(currentPriceCents: number, anchorCents: number, depthCents: number): number {
  if (!(anchorCents > 0) || !(currentPriceCents > anchorCents)) return 0;
  return validDepth(depthCents) * Math.log(currentPriceCents / anchorCents);
}
// The anchor that puts `sharesOutstanding` at `priceCents` on a curve of `depthCents`.
export function anchorFor(priceCents: number, sharesOutstanding: number, depthCents: number): number {
  return priceCents / (1 + (priceCents * Math.max(0, sharesOutstanding)) / validDepth(depthCents));
}
// The price the curve implies for `sharesOutstanding`.
export function curvePriceCents(anchorCents: number, sharesOutstanding: number, depthCents: number): number {
  return anchorCents / (1 - (anchorCents * sharesOutstanding) / validDepth(depthCents));
}

export type DepthPlan = {
  ok: boolean; reason?: string;
  priceCents: number; sharesOutstanding: number;
  oldDepthCents: number; newDepthCents: number; oldAnchorCents: number; newAnchorCents: number;
  reserveCents: number; owedBeforeCents: number; owedAfterCents: number;
  topUpCents: number;        // added to the reserve so it still covers everything owed
};
// A depth increase keeps the price and everyone's shares exactly as they are and re-anchors the curve
// around them. Holders can then sell with less slippage, so what they're owed rises; the reserve is topped
// up by exactly that much (rounded up to the cent). Depth may only increase, by at most DEPTH_MAX_STEP
// relative to `depthWindowStartCents` (the depth DEPTH_STEP_WINDOW_DAYS ago).
export function planDepthIncrease(input: {
  priceCents: number; sharesOutstanding: number; reserveCents: number; depthCents: number;
  newDepthCents: number; depthWindowStartCents?: number;
}): DepthPlan {
  const { priceCents, sharesOutstanding, reserveCents, depthCents, newDepthCents } = input;
  const windowStart = input.depthWindowStartCents ?? depthCents;
  const oldAnchorCents = anchorFor(priceCents, sharesOutstanding, depthCents);
  const base = { priceCents, sharesOutstanding, oldDepthCents: depthCents, newDepthCents, oldAnchorCents, reserveCents,
    owedBeforeCents: owedCents(priceCents, oldAnchorCents, depthCents) };
  const fail = (reason: string): DepthPlan => ({ ...base, ok: false, reason, newAnchorCents: oldAnchorCents, owedAfterCents: base.owedBeforeCents, topUpCents: 0 });
  if (!Number.isFinite(newDepthCents) || !(newDepthCents > 0)) return fail('depth must be a positive number');
  if (!(newDepthCents > depthCents)) return fail('depth can only increase');
  if (newDepthCents > windowStart * DEPTH_MAX_STEP * (1 + 1e-12)) {
    return fail(`depth can rise at most ×${DEPTH_MAX_STEP} in ${DEPTH_STEP_WINDOW_DAYS} days (limit now ${Math.floor(windowStart * DEPTH_MAX_STEP)} cents)`);
  }
  const newAnchorCents = anchorFor(priceCents, sharesOutstanding, newDepthCents);
  const owedAfterCents = owedCents(priceCents, newAnchorCents, newDepthCents);
  return { ...base, ok: true, newAnchorCents, owedAfterCents, topUpCents: Math.max(0, Math.ceil(owedAfterCents - reserveCents - 1e-9)) };
}

// Recommendation shown to admins (never applied automatically): 1,000 Credits of depth per player who traded
// in the last 30 days, never below the default.
export function recommendedDepthCents(activeTraders: number): number {
  return Math.max(DEFAULT_DEPTH_CENTS, DEPTH_CENTS_PER_ACTIVE_TRADER * Math.max(0, Math.floor(activeTraders)));
}

// Phase 0's exit value (with its $1.00 flat floor), kept only so the Phase 1 migration can prove that no
// holding's value changed (lib/market-ledger.ts verifyMarketMigration).
export function phase0ExitValueCents(currentPriceCents: number, shares: number): number {
  const K0 = 1 / DEFAULT_DEPTH_CENTS, MIN = 100;
  const p = Math.max(MIN, currentPriceCents);
  if (!(shares > 0)) return 0;
  const toFloor = p > MIN ? (p / MIN - 1) / (K0 * p) : 0;
  const exact = shares <= toFloor ? Math.log1p(K0 * p * shares) / K0 : Math.log(p / MIN) / K0 + (shares - toFloor) * MIN;
  return Math.max(0, floorCents(exact));
}

// The inverse of nextBasePriceCents: "what score would justify the current
// price, if price purely tracked the base formula?" Comparing this to the
// artist's actual NEXT Score is how NEXT surfaces its own headline idea —
// "when they disagree, that's the signal" — as an actual number instead of
// just a sentence.
//
// What the gap is, and isn't: NEXT Score is our Scouts' rating; NEXT Price
// is what players have bid in a game with virtual credits. The gap measures
// how far those two opinions have drifted apart — nothing more. It is not a
// "fair value" and an artist isn't objectively under- or over-priced, so
// user-facing wording describes a disagreement ("Scouts rate higher than the
// market"), never a valuation. The tone keys below keep their original
// names only because they're stored in feed_events.event_type.
export function impliedScoreFromPrice(priceCents: number): number {
  const dollars = priceCents / 100;
  const normalized = Math.pow(Math.max(0, (dollars - 1) / 49), 1 / 1.8);
  return Math.max(0, Math.min(100, normalized * 100));
}

export const SCOUT_GAP_EXPLAINER =
  "We turn the current NEXT Price back into the Score that would have set it as a starting price, and compare it with the Scouts' actual Score. " +
  "The gap shows where our Scouts and the players disagree. It's a difference of opinion, not a prediction — you decide who's right.";

export type MarketSentiment = {
  label: 'Scouts rate higher' | 'Market ahead of Scouts' | 'In line' | 'Not compared';
  tone: 'undervalued' | 'overheated' | 'fair';
  impliedScore: number;
  diff: number; // actual score minus implied score, in score points
  // false for artists listed at the uniform price (Phase 1): their price was never set from the Score, so
  // turning it back into an "implied Score" would invent a gap. Screens show no comparison for them.
  comparable: boolean;
};

// A few points of drift is noise, not a signal — only call it out once the
// score/price gap is big enough to matter.
const SENTIMENT_THRESHOLD = 4;

export function marketSentiment(actualScore: number, priceCents: number, listingRule: 'score' | 'uniform' | string = 'score'): MarketSentiment {
  if (listingRule === 'uniform') return { label: 'Not compared', tone: 'fair', impliedScore: actualScore, diff: 0, comparable: false };
  const impliedScore = impliedScoreFromPrice(priceCents);
  const diff = actualScore - impliedScore;
  if (diff >= SENTIMENT_THRESHOLD) return { label: 'Scouts rate higher', tone: 'undervalued', impliedScore, diff, comparable: true };
  if (diff <= -SENTIMENT_THRESHOLD) return { label: 'Market ahead of Scouts', tone: 'overheated', impliedScore, diff, comparable: true };
  return { label: 'In line', tone: 'fair', impliedScore, diff, comparable: true };
}
