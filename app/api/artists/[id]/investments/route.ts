import { NextResponse } from 'next/server';
import { createInvestmentEntry, getArtist, getInvestmentEntries } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { INVESTMENT_CATEGORIES, InvestmentEntryInput } from '@/lib/types';

export const dynamic = 'force-dynamic';

function parseId(idParam: string) {
  const id = Number(idParam);
  return Number.isInteger(id) ? id : null;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const id = parseId(params.id);
  if (id === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  if (!getArtist(id)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(getInvestmentEntries(id));
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const id = parseId(params.id);
  if (id === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  if (!getArtist(id)) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = (await req.json()) as InvestmentEntryInput;
  if (!body.recorded_at) {
    return NextResponse.json({ error: 'recorded_at is required' }, { status: 400 });
  }
  if (!body.category || !INVESTMENT_CATEGORIES.includes(body.category)) {
    return NextResponse.json({ error: 'a valid category is required' }, { status: 400 });
  }
  if (!Number.isFinite(body.amount_cents) || body.amount_cents < 0) {
    return NextResponse.json({ error: 'amount_cents must be a non-negative number' }, { status: 400 });
  }
  const entry = createInvestmentEntry(id, body, user);
  return NextResponse.json(entry, { status: 201 });
}
