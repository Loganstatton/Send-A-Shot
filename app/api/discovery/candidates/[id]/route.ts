import { NextResponse } from 'next/server';
import { getInternalUser } from '@/lib/auth';
import { approveDiscoveryCandidate, setDiscoveryCandidateStatus, updateArtist } from '@/lib/db';
import { ArtistInput } from '@/lib/types';
import { getTopSongForArtist } from '@/lib/deezer';

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

    // Same best-effort, one-time Deezer top-song lookup as the manual Add
    // Artist flow — a candidate becoming a real artist is another "an
    // artist enters the roster" moment, so it gets the same treatment.
    if (!artist.top_song_url || !artist.photo_url) {
      const result = await getTopSongForArtist(artist.name).catch((err) => {
        console.error('[deezer-lookup] on-approve lookup threw for', artist!.name, err?.message);
        return null;
      });
      if (result?.ok) {
        artist = updateArtist(artist.id, result.data as ArtistInput) ?? artist;
      } else if (result) {
        console.log('[deezer-lookup] on-approve lookup found no top song for', artist.name, `(${result.reason})`, result.error ?? '');
      }
    }

    return NextResponse.json({ artist });
  }
  return NextResponse.json({ error: "action must be 'watch', 'pass', or 'approve'" }, { status: 400 });
}
