import { NextResponse } from 'next/server';
import {
  executeTrade, getFeedEvent, getRecentTradeCount, getStoredTradeResponse, logEvent, storeTradeResponse, TRADE_RATE_LIMIT_PER_MINUTE,
} from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { NextTransactionType } from '@/lib/types';

export const dynamic = 'force-dynamic';

function respond(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  // Any logged-in user can paper-trade — public, internal, and admin alike.
  const user = await getSessionUser();
  if (!user) return respond(401, { error: 'unauthorized' });

  const artistId = Number(params.id);
  if (!Number.isInteger(artistId)) return respond(400, { error: 'invalid id' });

  const body = (await req.json()) as {
    type?: NextTransactionType; credits_amount_cents?: number; idempotencyKey?: string;
    referralSource?: string; referralFeedEventId?: number;
  };
  if (body.type !== 'buy' && body.type !== 'sell') {
    return respond(400, { error: "type must be 'buy' or 'sell'" });
  }
  if (!Number.isFinite(body.credits_amount_cents) || (body.credits_amount_cents ?? 0) <= 0) {
    return respond(400, { error: 'credits_amount_cents must be a positive number' });
  }

  // Idempotency: a retried/duplicated request carrying the same
  // client-generated key gets back the ORIGINAL trade's result instead of
  // executing a second real trade. Checked before anything else — a hit
  // here means this exact attempt was already fully handled.
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.slice(0, 100) : undefined;
  if (idempotencyKey) {
    const stored = getStoredTradeResponse(user.id, idempotencyKey);
    if (stored) return respond(stored.status, stored.body);
  }

  // Anti-spam rate limit — see TRADE_RATE_LIMIT_PER_MINUTE's own comment;
  // this isn't stored under the idempotency key since a 429 isn't "the
  // result of this trade attempt," it's "try again shortly."
  if (getRecentTradeCount(user.id, 1) >= TRADE_RATE_LIMIT_PER_MINUTE) {
    return respond(429, { error: "You're trading faster than we can keep up — wait a moment and try again." });
  }

  const result = executeTrade(user.id, artistId, body.type, body.credits_amount_cents!);
  const status = result.ok ? 200 : 400;
  const responseBody = result.ok ? result : { error: result.error };
  if (idempotencyKey) storeTradeResponse(user.id, idempotencyKey, status, responseBody);

  if (!result.ok) return respond(status, responseBody);
  logEvent(user.id, body.type === 'buy' ? 'buy_completed' : 'sell_completed', { artistId, creditsAmountCents: body.credits_amount_cents });

  // Feed referral attribution — additive only, never affects the trade
  // above (already fully executed and validated by this point). Only
  // logged for a genuinely executed trade, not an idempotent replay (this
  // whole block is unreachable on a replay — see the early return above).
  // Re-checks the feed_events row actually exists so a tampered/garbage id
  // can't poison analytics with a fake reference.
  if (body.referralSource === 'feed' && Number.isInteger(body.referralFeedEventId) && getFeedEvent(body.referralFeedEventId!)) {
    logEvent(user.id, 'feed_trade_completed', {
      artistId, feedEventId: body.referralFeedEventId, tradeType: body.type, creditsAmountCents: body.credits_amount_cents,
    });
  }

  return respond(status, responseBody);
}
