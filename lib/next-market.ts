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

// Every $10,000 of NEXT Credits traded on one side moves price ~5%. Buys
// push it up, sells push it down; the floor keeps a heavily-sold artist from
// hitting zero.
const IMPACT_PER_CREDITS_CENTS = 1_000_000;
const IMPACT_RATE = 0.05;

export function priceImpactPct(creditsAmountCents: number): number {
  return (creditsAmountCents / IMPACT_PER_CREDITS_CENTS) * IMPACT_RATE;
}

export function applyTradeImpact(priceCents: number, creditsAmountCents: number, direction: 'buy' | 'sell'): number {
  const impact = priceImpactPct(creditsAmountCents);
  const factor = direction === 'buy' ? 1 + impact : 1 - impact;
  return Math.max(NEXT_MIN_PRICE_CENTS, Math.round(priceCents * factor));
}

// A trade fills at the AVERAGE of the pre- and post-impact price, not the
// pre-impact price — i.e. the trader pays/receives their own slippage,
// instead of it being free money on their very next trade. Without this, a
// buy executes at the cheap pre-impact price while the impact is banked
// into the market price, and an immediate sell captures that gap as pure
// profit with zero outside market activity — a self-sandwich exploit. With
// average execution on both legs, round-tripping (buy then immediately
// sell, nothing else happening) costs a small amount every time, the same
// way a bid-ask spread does in a real market, and never manufactures
// credits. See lib/db.test.ts for the automated proof.
export function executionPriceCents(prePriceCents: number, postPriceCents: number): number {
  return Math.max(NEXT_MIN_PRICE_CENTS, Math.round((prePriceCents + postPriceCents) / 2));
}

export type SellQuote = { postPriceCents: number; executionCents: number; proceedsCents: number };

// What selling `shares` right now would actually net, using the exact same
// average-execution math a real sell fills at (see executionPriceCents'
// comment). This is the single source of truth for two different callers
// that must never drift apart: executeTrade's real sell path, and anywhere
// a held position needs to be marked to a REALISTIC exit value rather than
// the raw quoted price. Marking to the raw quote overstates a position —
// the quote right after a buy already includes that buy's own upward
// impact, which a same-size sell mostly reverses, so "unrealized P&L"
// computed against the raw quote is a paper gain that evaporates the
// moment you actually try to sell.
export function quoteSell(currentPriceCents: number, shares: number): SellQuote {
  const notionalAtCurrentPriceCents = Math.round(shares * currentPriceCents);
  const postPriceCents = applyTradeImpact(currentPriceCents, notionalAtCurrentPriceCents, 'sell');
  const executionCents = executionPriceCents(currentPriceCents, postPriceCents);
  const proceedsCents = Math.round(shares * executionCents);
  return { postPriceCents, executionCents, proceedsCents };
}

// The inverse of nextBasePriceCents: "what score would justify the current
// price, if price purely tracked the base formula?" Comparing this to the
// artist's actual NEXT Score is how NEXT surfaces its own headline idea —
// "when they disagree, that's the signal" — as an actual number instead of
// just a sentence. A price above what the score would set on its own means
// the market is pricing in more than the fundamentals show (overheated); a
// price below means the market hasn't caught up yet (undervalued).
export function impliedScoreFromPrice(priceCents: number): number {
  const dollars = priceCents / 100;
  const normalized = Math.pow(Math.max(0, (dollars - 1) / 49), 1 / 1.8);
  return Math.max(0, Math.min(100, normalized * 100));
}

export type MarketSentiment = {
  label: 'Undervalued' | 'Overheated' | 'Fair value';
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
  if (diff >= SENTIMENT_THRESHOLD) return { label: 'Undervalued', tone: 'undervalued', impliedScore, diff };
  if (diff <= -SENTIMENT_THRESHOLD) return { label: 'Overheated', tone: 'overheated', impliedScore, diff };
  return { label: 'Fair value', tone: 'fair', impliedScore, diff };
}
