import { NextResponse } from 'next/server';
import { createArtist, getAllArtists, updateArtist } from '@/lib/db';
import { getInternalUser } from '@/lib/auth';
import { ArtistInput } from '@/lib/types';
import { getTopSongForArtist } from '@/lib/deezer';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getInternalUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(getAllArtists());
}

export async function POST(req: Request) {
  const user = await getInternalUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await req.json()) as ArtistInput;
  if (!body.name || !body.name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  let artist = createArtist(body, user);

  // Best-effort, one-time Deezer top-song lookup right at creation — a
  // Scout adding a real artist expects this to just be there, not to
  // require a separate trip to the dashboard's batch sync button. Never
  // blocks or fails artist creation: any lookup failure (no match, a real
  // API error) just leaves top_song_url empty for the batch sync to try
  // again later.
  if (!artist.top_song_url) {
    const result = await getTopSongForArtist(artist.name).catch(() => null);
    if (result?.ok) {
      artist = updateArtist(artist.id, result.data as ArtistInput) ?? artist;
    }
  }

  return NextResponse.json(artist, { status: 201 });
}
