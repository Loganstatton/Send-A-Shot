import { NextResponse } from 'next/server';
import { getAdminUser } from '@/lib/auth';
import { removeArtistProvidedPhoto } from '@/lib/db';

export const dynamic = 'force-dynamic';

// The migration brief's "admin must be able to remove an uploaded asset" —
// admin-only (not the claimed artist themself, not a plain internal Scout)
// since this is a moderation action on someone's self-submitted content.
// A no-op, not an error, on an artist whose photo isn't ARTIST_PROVIDED —
// see removeArtistProvidedPhoto in lib/db.ts.
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const id = Number(params.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const updated = removeArtistProvidedPhoto(id);
  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
