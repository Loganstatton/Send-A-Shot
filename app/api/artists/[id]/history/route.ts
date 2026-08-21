import { NextResponse } from 'next/server';
import { getArtist, getScoreHistory } from '@/lib/db';
import { getInternalUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getInternalUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const id = Number(params.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  if (!getArtist(id)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(getScoreHistory(id));
}
