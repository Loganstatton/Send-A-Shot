import { NextResponse } from 'next/server';
import { addToWatchlist, getArtist, isWatchlisted, logEvent, removeFromWatchlist, setWatchlistAlerts } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const artistId = Number(params.id);
  if (!Number.isInteger(artistId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  if (!await getArtist(artistId)) return NextResponse.json({ error: 'not found' }, { status: 404 });

  await addToWatchlist(user.id, artistId);
  await logEvent(user.id, 'watchlist_added', { artistId });
  return NextResponse.json({ ok: true, watching: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const artistId = Number(params.id);
  if (!Number.isInteger(artistId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  await removeFromWatchlist(user.id, artistId);
  await logEvent(user.id, 'watchlist_removed', { artistId });
  return NextResponse.json({ ok: true, watching: false });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const artistId = Number(params.id);
  if (!Number.isInteger(artistId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  if (!await isWatchlisted(user.id, artistId)) return NextResponse.json({ error: 'not watching this artist' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  if (typeof body.alertsEnabled !== 'boolean') return NextResponse.json({ error: 'alertsEnabled must be a boolean' }, { status: 400 });

  await setWatchlistAlerts(user.id, artistId, body.alertsEnabled);
  return NextResponse.json({ ok: true, alertsEnabled: body.alertsEnabled });
}
