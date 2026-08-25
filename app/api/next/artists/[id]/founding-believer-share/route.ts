import { NextResponse } from 'next/server';
import { getFoundingBelieverRecord, shareFoundingBelieverToFeed } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// The one explicit, user-initiated NEXT Feed event — see
// shareFoundingBelieverToFeed's own comment in lib/db.ts. Never triggered
// automatically; this route only exists because a person clicked "Share."
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const artistId = Number(params.id);
  if (!Number.isInteger(artistId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  // Checked separately from the share call itself so a real error (you
  // never backed this artist) and a benign no-op (you already shared it
  // today — dedupe_key) don't collapse into the same response.
  if (!getFoundingBelieverRecord(user.id, artistId)) {
    return NextResponse.json({ error: 'no founding believer record for this artist' }, { status: 404 });
  }

  const event = shareFoundingBelieverToFeed(user.id, artistId);
  if (event === null) return NextResponse.json({ shared: false, reason: 'already shared today' }, { status: 200 });
  return NextResponse.json({ shared: true, event }, { status: 201 });
}
