import { NextResponse } from 'next/server';
import { getArtist, getScoreHistory } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  if (!getArtist(id)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(getScoreHistory(id));
}
