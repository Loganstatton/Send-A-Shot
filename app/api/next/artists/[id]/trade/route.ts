import { NextResponse } from 'next/server';
import { executeTradeRequest, getFeedEvent, logEvent } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { NextTransactionType } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Far above anything a real account can hold, and above the "sell
// everything" sentinel (see SELL_ALL_SENTINEL_CENTS) — just a bound so an
// absurd number never reaches the trade math.
const MAX_TRADE_AMOUNT_CENTS = 1_000_000_000_000;

function respond(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  // Any logged-in user can paper-trade — public, internal, and admin alike.
  const user = await getSessionUser();
  if (!user) return respond(401, { error: 'unauthorized' });

  const artistId = Number(params.id);
  if (!Number.isInteger(artistId)) return respond(400, { error: 'invalid id' });

  const body = (await req.json().catch(() => null)) as {
    type?: NextTransactionType; credits_amount_cents?: number; idempotencyKey?: string;
    referralSource?: string; referralFeedEventId?: number;
  } | null;
  if (!body || typeof body !== 'object') return respond(400, { error: 'invalid request body' });
  if (body.type !== 'buy' && body.type !== 'sell') {
    return respond(400, { error: "type must be 'buy' or 'sell'" });
  }
  if (
    typeof body.credits_amount_cents !== 'number' || !Number.isFinite(body.credits_amount_cents) ||
    body.credits_amount_cents <= 0 || body.credits_amount_cents > MAX_TRADE_AMOUNT_CENTS
  ) {
    return respond(400, { error: 'credits_amount_cents must be a positive number' });
  }

  // Duplicate check, rate limit, the trade itself and remembering its
  // response all happen inside executeTradeRequest as one atomic step — see
  // its own comment for why they can't be separate calls from here. A
  // retried/duplicated request carrying the same client-generated key gets
  // back the ORIGINAL response (`replayed`) instead of trading twice.
  const idempotencyKey = typeof body.idempotencyKey === 'string' && body.idempotencyKey ? body.idempotencyKey.slice(0, 100) : undefined;
  const outcome = await executeTradeRequest(user.id, artistId, body.type, body.credits_amount_cents, idempotencyKey);
  const { status, body: responseBody, result } = outcome;
  if (outcome.replayed || !result) return respond(status, responseBody);

  if (!result.ok) return respond(status, responseBody);
  await logEvent(user.id, body.type === 'buy' ? 'buy_completed' : 'sell_completed', { artistId, creditsAmountCents: body.credits_amount_cents });

  // Feed referral attribution — additive only, never affects the trade
  // above (already fully executed and validated by this point). Only
  // logged for a genuinely executed trade, never an idempotent replay (a
  // replay returned above, before reaching here).
  // Re-checks the feed_events row actually exists so a tampered/garbage id
  // can't poison analytics with a fake reference.
  if (body.referralSource === 'feed' && Number.isInteger(body.referralFeedEventId) && await getFeedEvent(body.referralFeedEventId!)) {
    await logEvent(user.id, 'feed_trade_completed', {
      artistId, feedEventId: body.referralFeedEventId, tradeType: body.type, creditsAmountCents: body.credits_amount_cents,
    });
  }

  return respond(status, responseBody);
}
