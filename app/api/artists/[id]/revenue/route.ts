import { NextResponse } from 'next/server';
import { createRevenueEntry, getArtist, getRevenueEntries } from '@/lib/db';
import { getInternalUser } from '@/lib/auth';
import { REVENUE_SOURCES, RevenueEntryInput } from '@/lib/types';

export const dynamic = 'force-dynamic';

function parseId(idParam: string) {
  const id = Number(idParam);
  return Number.isInteger(id) ? id : null;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getInternalUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const id = parseId(params.id);
  if (id === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  if (!getArtist(id)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(getRevenueEntries(id));
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await getInternalUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const id = parseId(params.id);
  if (id === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  if (!getArtist(id)) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = (await req.json()) as RevenueEntryInput;
  if (!body.recorded_at) {
    return NextResponse.json({ error: 'recorded_at is required' }, { status: 400 });
  }
  if (!body.source || !REVENUE_SOURCES.includes(body.source)) {
    return NextResponse.json({ error: 'a valid source is required' }, { status: 400 });
  }
  if (!Number.isFinite(body.gross_amount_cents) || body.gross_amount_cents < 0) {
    return NextResponse.json({ error: 'gross_amount_cents must be a non-negative number' }, { status: 400 });
  }
  const entry = createRevenueEntry(id, body, user);
  return NextResponse.json(entry, { status: 201 });
}
