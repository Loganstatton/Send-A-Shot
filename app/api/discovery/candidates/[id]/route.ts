import { NextResponse } from 'next/server';
import { getInternalUser } from '@/lib/auth';
import { approveDiscoveryCandidate, setDiscoveryCandidateStatus, updateArtist } from '@/lib/db';
import { ArtistInput } from '@/lib/types';
import { getTopSongForArtist, spotifyConfigured } from '@/lib/spotify';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await getInternalUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const id = Number(params.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const body = (await req.json()) as { action?: 'watch' | 'pass' | 'approve' };
  if (body.action === 'watch' || body.action === 'pass') {
    const updated = setDiscoveryCandidateStatus(id, body.action === 'watch' ? 'watching' : 'passed', user);
    if (!updated) return NextResponse.json({ error: 'candidate not found' }, { status: 404 });
    return NextResponse.json(updated);
  }
  if (body.action === 'approve') {
    let artist = approveDiscoveryCandidate(id, user);
    if (!artist) return NextResponse.json({ error: 'candidate not found or already approved' }, { status: 404 });

    // Same best-effort, one-time Spotify top-song lookup as the manual Add
    // Artist flow — a candidate becoming a real artist is another "an
    // artist enters the roster" moment, so it gets the same treatment.
    if (spotifyConfigured() && !artist.top_song_url) {
      const result = await getTopSongForArtist(artist.name, artist.spotify_url).catch(() => null);
      if (result?.ok) {
        artist = updateArtist(artist.id, result.data as ArtistInput) ?? artist;
      }
    }

    return NextResponse.json({ artist });
  }
  return NextResponse.json({ error: "action must be 'watch', 'pass', or 'approve'" }, { status: 400 });
}
