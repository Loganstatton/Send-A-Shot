import { NextResponse } from 'next/server';
import { addToWatchlist, getArtist, removeFromWatchlist } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const artistId = Number(params.id);
  if (!Number.isInteger(artistId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  if (!getArtist(artistId)) return NextResponse.json({ error: 'not found' }, { status: 404 });

  addToWatchlist(user.id, artistId);
  return NextResponse.json({ ok: true, watching: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const artistId = Number(params.id);
  if (!Number.isInteger(artistId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  removeFromWatchlist(user.id, artistId);
  return NextResponse.json({ ok: true, watching: false });
}
