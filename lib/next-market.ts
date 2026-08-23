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

export const NEXT_STARTING_CREDITS_CENTS = 1_000_000; // $10,000.00 in NEXT Credits
export const NEXT_MIN_PRICE_CENTS = 100; // price floor: $1.00

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
