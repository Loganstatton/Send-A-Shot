import { NextResponse } from 'next/server';
import { createArtist, findArtistsByName, getAllArtists, setFeaturedVideoMatchType, stampSourceSyncedAt, updateArtist } from '@/lib/db';
import { getInternalUser } from '@/lib/auth';
import { Artist, ArtistInput } from '@/lib/types';
import { getTopSongForArtist } from '@/lib/deezer';
import { getFeaturedVideoForArtist, youtubeConfigured } from '@/lib/youtube';

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

  // Duplicate-name handling: two different real artists can legitimately
  // share a name, so this never blocks creation — just flags it so the
  // Scout can double-check they're not about to create a second row for an
  // artist already on the roster (an outright duplicate identity, like the
  // same Soundcharts uuid, is instead a hard error — see createArtist's
  // unique index in lib/db.ts).
  const existingNameMatches = findArtistsByName(body.name);

  let artist: Artist;
  try {
    artist = createArtist(body, user);
  } catch (err: any) {
    // The one case that IS blocked: the same Soundcharts identity linked
    // twice (see the unique index in lib/db.ts) — that's not "two artists
    // with the same name," it's definitely the same real artist already on
    // the roster.
    if (/UNIQUE constraint failed.*soundcharts_uuid/i.test(err?.message ?? '')) {
      return NextResponse.json({ error: 'An artist with this Soundcharts link already exists on the roster.' }, { status: 409 });
    }
    throw err;
  }

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
      stampSourceSyncedAt(artist.id, 'deezer');
      artist = updateArtist(artist.id, result.data as ArtistInput) ?? artist;
    } else if (result) {
      // Logged (not silently dropped) so a Scout wondering why a real
      // artist's top song didn't fill in on creation can check Render's
      // logs instead of only seeing an empty field with no explanation.
      if (result.reason === 'no_artist_match' || result.reason === 'no_top_track') stampSourceSyncedAt(artist.id, 'deezer');
      console.log('[deezer-lookup] on-create lookup found no top song for', artist.name, `(${result.reason})`, result.error ?? '');
    }
  }

  // Same best-effort, one-time lookup for the featured video — a manually
  // added artist otherwise sits with a blank NEXT hero forever, since
  // (unlike Deezer's top song) nothing else ever fills this in for them.
  // Never blocks or fails artist creation. Passes the artist's YouTube
  // channel (from Soundcharts, if it found one) so this can skip the
  // 100-unit search call in favor of a 2-unit channel lookup when possible.
  if (!artist.featured_video_id && youtubeConfigured()) {
    const result = await getFeaturedVideoForArtist(artist.name, artist.youtube_url ?? undefined).catch((err) => {
      console.error('[youtube-lookup] on-create lookup threw for', artist.name, err?.message);
      return null;
    });
    if (result?.ok) {
      stampSourceSyncedAt(artist.id, 'youtube');
      if (result.data) {
        setFeaturedVideoMatchType(artist.id, result.data.matchType);
        artist = updateArtist(artist.id, { featured_video_id: result.data.videoId } as ArtistInput) ?? artist;
      }
    } else if (result && !result.ok) {
      console.log('[youtube-lookup] on-create lookup failed for', artist.name, result.error);
    }
  }

  return NextResponse.json({
    ...artist,
    // Non-blocking heads-up only — see the comment above createArtist.
    duplicateNameWarning: existingNameMatches.length > 0 ? existingNameMatches : undefined,
  }, { status: 201 });
}
