import { NextResponse } from 'next/server';
import { getFoundingBelieverRecord, getNextArtist } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { renderProofCard } from '@/lib/proof-card';

export const dynamic = 'force-dynamic';

// The signed-in Scout's own Founding Believer card for an artist, as a
// downloadable PNG. The public, shareable version of the same card (with
// the holder's name on it) is /api/next/proof/[recordId]/card.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const artistId = Number(params.id);
  if (!Number.isInteger(artistId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const row = await getNextArtist(artistId);
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const record = await getFoundingBelieverRecord(user.id, artistId);
  if (!record) return NextResponse.json({ error: 'no founding believer record' }, { status: 404 });

  return renderProofCard({ artist: row.artist, score: row.score, priceCents: row.priceCents, record });
}
