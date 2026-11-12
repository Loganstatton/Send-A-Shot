import { NextResponse } from 'next/server';
import { getFoundingBelieverRecordById, getNextArtist, getUserById } from '@/lib/db';
import { renderProofCard } from '@/lib/proof-card';

export const dynamic = 'force-dynamic';

// Public: the preview image for a shared early-proof link
// (/next/proof/[recordId]). Shows only what that page shows publicly — the
// holder's display name, the artist, backer number, date, and then-vs-now
// Score and Price.
export async function GET(_req: Request, { params }: { params: { recordId: string } }) {
  const recordId = Number(params.recordId);
  if (!Number.isInteger(recordId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const record = await getFoundingBelieverRecordById(recordId);
  if (!record) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const row = await getNextArtist(record.artist_id);
  const holder = await getUserById(record.user_id);
  if (!row || !holder) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const image = renderProofCard({ artist: row.artist, score: row.score, priceCents: row.priceCents, record, holderName: holder.name });
  // Then/now numbers move with the market — let link previews refresh.
  image.headers.set('Cache-Control', 'public, max-age=600');
  return image;
}
