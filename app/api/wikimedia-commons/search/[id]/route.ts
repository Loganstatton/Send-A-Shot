import { NextResponse } from 'next/server';
import { getInternalUser } from '@/lib/auth';
import { getArtist } from '@/lib/db';
import { findCommonsImagesForArtist } from '@/lib/wikimedia-commons';

export const dynamic = 'force-dynamic';

// Scout-triggered image search — returns only license-clear candidates
// (see lib/wikimedia-commons.ts's isPermissiveLicense) for the Scout to
// pick from in the artist edit form. Picking one fills photo_url +
// provenance fields into the form same as SoundchartsSearch; nothing is
// written to the database until the Scout hits Save.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const user = await getInternalUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const id = Number(params.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const artist = getArtist(id);
  if (!artist) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const result = await findCommonsImagesForArtist(artist.name, artist.wikidata_qid);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json(result.data);
}
