import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createArtistRequest } from '@/lib/artist-requests';

export const dynamic = 'force-dynamic';

// Report a problem with an artist profile, or (for the verified artist)
// ask for a correction, a rating review, or removal. Signed-in only, so
// every report has an accountable account behind it; rate limited.
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Log in to send a report.' }, { status: 401 });
  const artistId = Number((await props.params).id);
  if (!Number.isInteger(artistId)) return NextResponse.json({ error: 'Artist not found.' }, { status: 404 });
  const body = await req.json().catch(() => null);
  const result = await createArtistRequest({ artistId, userId: user.id, kind: body?.kind, message: body?.message });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ id: result.request.id }, { status: 201 });
}
