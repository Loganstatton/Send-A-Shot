import { NextResponse } from 'next/server';
import { executeTrade } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { NextTransactionType } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  // Any logged-in user can paper-trade — public, internal, and admin alike.
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const artistId = Number(params.id);
  if (!Number.isInteger(artistId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const body = (await req.json()) as { type?: NextTransactionType; credits_amount_cents?: number };
  if (body.type !== 'buy' && body.type !== 'sell') {
    return NextResponse.json({ error: "type must be 'buy' or 'sell'" }, { status: 400 });
  }
  if (!Number.isFinite(body.credits_amount_cents) || (body.credits_amount_cents ?? 0) <= 0) {
    return NextResponse.json({ error: 'credits_amount_cents must be a positive number' }, { status: 400 });
  }

  const result = executeTrade(user.id, artistId, body.type, body.credits_amount_cents!);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
