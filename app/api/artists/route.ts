import { NextResponse } from 'next/server';
import { createArtist, getAllArtists, updateArtist } from '@/lib/db';
import { getInternalUser } from '@/lib/auth';
import { ArtistInput } from '@/lib/types';
import { getTopSongForArtist } from '@/lib/deezer';
import { searchArtistVideo, youtubeConfigured } from '@/lib/youtube';

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
    const result = await getTopSongForArtist(artist.name).catch((err) => {
      console.error('[deezer-lookup] on-create lookup threw for', artist.name, err?.message);
      return null;
    });
    if (result?.ok) {
      artist = updateArtist(artist.id, result.data as ArtistInput) ?? artist;
    } else if (result) {
      // Logged (not silently dropped) so a Scout wondering why a real
      // artist's top song didn't fill in on creation can check Render's
      // logs instead of only seeing an empty field with no explanation.
      console.log('[deezer-lookup] on-create lookup found no top song for', artist.name, `(${result.reason})`, result.error ?? '');
    }
  }

  // Same best-effort, one-time lookup for the featured video — a manually
  // added artist otherwise sits with a blank NEXT hero forever, since
  // (unlike Deezer's top song) nothing else ever fills this in for them.
  // Never blocks or fails artist creation.
  if (!artist.featured_video_id && youtubeConfigured()) {
    const result = await searchArtistVideo(artist.name).catch((err) => {
      console.error('[youtube-lookup] on-create lookup threw for', artist.name, err?.message);
      return null;
    });
    if (result?.ok && result.data) {
      artist = updateArtist(artist.id, { featured_video_id: result.data.videoId } as ArtistInput) ?? artist;
    } else if (result && !result.ok) {
      console.log('[youtube-lookup] on-create lookup failed for', artist.name, result.error);
    }
  }

  return NextResponse.json(artist, { status: 201 });
}
