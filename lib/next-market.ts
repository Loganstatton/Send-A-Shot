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
export const NEXT_MIN_PRICE_CENTS = 100; // price floor: $1.00

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

// Base price when an artist first enters the market: a $1-$50 range, curved
// so a strong score commands a disproportionately higher starting price
// (score 55 -> ~$17.70, score 94 -> ~$44.84, score 100 -> $50.00).
export function nextBasePriceCents(score: number): number {
  const normalized = Math.max(0, Math.min(100, score)) / 100;
  const dollars = 1 + Math.pow(normalized, 1.8) * 49;
  return Math.round(dollars * 100);
}

// ---------------------------------------------------------------------------------------------
// Price impact and execution — exact and path-independent (Phase 0 fix, 2026-11-15).
//
// The rule is unchanged: every 10,000 Credits traded on one side moves the price about 5%; buys push it
// up, sells push it down, and the price never goes below $1.00. What changed is HOW a trade is computed.
//
// Before: each trade applied the impact as one step and rounded the new price, and the fill price, to
// whole cents. Small trades' moves rounded to nothing (or up a cent), so slicing a trade into many small
// ones beat doing it at once — a single player could buy $10,000 in one go and sell it back in $40
// slices for ~+$243 with nobody else trading (see research/market-sim/exploit-check.mjs).
//
// Now each trade is the exact total along the continuous version of the same rule:
//   the price moves by a factor e^(k·credits) for credits flowing in (buys) and e^(−k·credits) for
//   credits flowing out (sells), k = 5% per 10,000 Credits;
//   a buy of B credits at price p gets   shares = (1 − e^(−kB)) / (k·p),   new price p·e^(kB);
//   a sell of s shares at price p pays   ln(1 + k·p·s) / k,               new price p / (1 + k·p·s).
// The price is therefore a function of the net credits that have flowed in, so a trade's result
// depends only on where it starts and ends — not on how it is sliced. A round trip with nobody else
// trading returns exactly what went in, minus rounding, and rounding always goes AGAINST the trader:
// shares bought round down (to 1e-9 shares), proceeds round down to the cent, and a tiny guard
// absorbs floating-point error so it can never round in the trader's favour. The price itself is kept
// at full precision (artists.next_current_price_cents is NUMERIC); only displays round to the cent.
// Below the $1.00 floor the price stops falling and further sells fill flat at $1.00 (never above).
// ---------------------------------------------------------------------------------------------
const IMPACT_PER_CREDITS_CENTS = 1_000_000;
const IMPACT_RATE = 0.05;
const K = IMPACT_RATE / IMPACT_PER_CREDITS_CENTS;            // per cent of credits
export const SHARE_DECIMALS = 9;
const SHARE_SCALE = 10 ** SHARE_DECIMALS;
const GUARD = 1e-9;                                          // relative guard against floating-point error

function floorShares(x: number): number { return Math.floor(x * SHARE_SCALE * (1 - GUARD)) / SHARE_SCALE; }
function ceilShares(x: number): number { return Math.ceil(x * SHARE_SCALE) / SHARE_SCALE; }
function floorCents(x: number): number { return Math.floor(x * (1 - GUARD)); }

// How far the price moves for `creditsAmountCents` traded on one side (as a fraction, e.g. 0.051).
export function priceImpactPct(creditsAmountCents: number): number {
  return Math.expm1(K * creditsAmountCents);
}

export type BuyQuote = { postPriceCents: number; executionCents: number; shares: number };
export type SellQuote = { postPriceCents: number; executionCents: number; proceedsCents: number };

// What spending `creditsCents` right now would get: the exact fill executeTrade's buy uses.
export function quoteBuy(currentPriceCents: number, creditsCents: number): BuyQuote {
  const p = Math.max(NEXT_MIN_PRICE_CENTS, currentPriceCents);
  if (!(creditsCents > 0)) return { postPriceCents: p, executionCents: p, shares: 0 };
  const shares = floorShares(-Math.expm1(-K * creditsCents) / (K * p));
  const postPriceCents = p * Math.exp(K * creditsCents);
  return { postPriceCents, executionCents: shares > 0 ? creditsCents / shares : p, shares };
}

// What selling `shares` right now would actually net — the single source of truth for executeTrade's
// sell AND for every "realistic exit value" (portfolios, leaderboards), so the two can never drift.
export function quoteSell(currentPriceCents: number, shares: number): SellQuote {
  const p = Math.max(NEXT_MIN_PRICE_CENTS, currentPriceCents);
  if (!(shares > 0)) return { postPriceCents: p, executionCents: p, proceedsCents: 0 };
  // shares the curve can absorb before the price reaches the $1.00 floor
  const toFloor = p > NEXT_MIN_PRICE_CENTS ? (p / NEXT_MIN_PRICE_CENTS - 1) / (K * p) : 0;
  let exact: number, postPriceCents: number;
  if (shares <= toFloor) {
    exact = Math.log1p(K * p * shares) / K;
    postPriceCents = p / (1 + K * p * shares);
  } else {
    exact = Math.log(p / NEXT_MIN_PRICE_CENTS) / K + (shares - toFloor) * NEXT_MIN_PRICE_CENTS;
    postPriceCents = NEXT_MIN_PRICE_CENTS;
  }
  const proceedsCents = Math.max(0, floorCents(exact));
  return { postPriceCents: Math.max(NEXT_MIN_PRICE_CENTS, postPriceCents), executionCents: proceedsCents / shares, proceedsCents };
}

// "Sell $X worth": the shares whose exact proceeds are X (rounded up to the share step, so the seller
// receives at most X after rounding). executeTrade caps the result at the shares actually owned.
export function sharesForSellCredits(currentPriceCents: number, creditsCents: number): number {
  const p = Math.max(NEXT_MIN_PRICE_CENTS, currentPriceCents);
  if (!(creditsCents > 0)) return 0;
  const toFloorCredits = p > NEXT_MIN_PRICE_CENTS ? Math.log(p / NEXT_MIN_PRICE_CENTS) / K : 0;
  if (creditsCents <= toFloorCredits) return ceilShares(Math.expm1(K * creditsCents) / (K * p));
  return ceilShares((p / NEXT_MIN_PRICE_CENTS - 1) / (K * p) + (creditsCents - toFloorCredits) / NEXT_MIN_PRICE_CENTS);
}

// The price after `creditsAmountCents` traded on one side (buy: credits in; sell: credits received).
// Used by the trade panel's preview, so the preview and the fill come from the same formula.
export function applyTradeImpact(priceCents: number, creditsAmountCents: number, direction: 'buy' | 'sell'): number {
  if (direction === 'buy') return quoteBuy(priceCents, creditsAmountCents).postPriceCents;
  return quoteSell(priceCents, sharesForSellCredits(priceCents, creditsAmountCents)).postPriceCents;
}

// The average fill price of a trade that moved the price from pre to post along the curve:
// pre·post·ln(post/pre)/(post − pre) for both buys and sells (pre when the price didn't move).
export function executionPriceCents(prePriceCents: number, postPriceCents: number): number {
  if (!(Math.abs(postPriceCents - prePriceCents) > 1e-9 * prePriceCents)) return prePriceCents;
  return (prePriceCents * postPriceCents * Math.log(postPriceCents / prePriceCents)) / (postPriceCents - prePriceCents);
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
  label: 'Scouts rate higher' | 'Market ahead of Scouts' | 'In line';
  tone: 'undervalued' | 'overheated' | 'fair';
  impliedScore: number;
  diff: number; // actual score minus implied score, in score points
};

// A few points of drift is noise, not a signal — only call it out once the
// score/price gap is big enough to matter.
const SENTIMENT_THRESHOLD = 4;

export function marketSentiment(actualScore: number, priceCents: number): MarketSentiment {
  const impliedScore = impliedScoreFromPrice(priceCents);
  const diff = actualScore - impliedScore;
  if (diff >= SENTIMENT_THRESHOLD) return { label: 'Scouts rate higher', tone: 'undervalued', impliedScore, diff };
  if (diff <= -SENTIMENT_THRESHOLD) return { label: 'Market ahead of Scouts', tone: 'overheated', impliedScore, diff };
  return { label: 'In line', tone: 'fair', impliedScore, diff };
}
