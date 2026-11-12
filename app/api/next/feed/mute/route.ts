import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { getArtist, setFeedArtistMuted } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Mute (POST) or unmute (DELETE) an artist in this player's Feed.
async function handle(req: Request, muted: boolean) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const artistId = Number(body?.artistId);
  if (!Number.isInteger(artistId) || !(await getArtist(artistId))) return NextResponse.json({ error: 'not found' }, { status: 404 });
  await setFeedArtistMuted(user.id, artistId, muted);
  return NextResponse.json({ ok: true });
}
export const POST = (req: Request) => handle(req, true);
export const DELETE = (req: Request) => handle(req, false);
