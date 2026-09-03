import { NextResponse } from 'next/server';
import { getInternalUser } from '@/lib/auth';
import { getArtist, saveWikidataMatch, saveWikidataNoMatch } from '@/lib/db';
import { findWikidataMatch } from '@/lib/wikidata';

export const dynamic = 'force-dynamic';

// Scout-triggered, one artist at a time (mirrors SoundchartsSearch's
// search-then-fill UX) — never a background crawl. Caches the match/
// no-match outcome (see lib/db.ts's wikidata_qid/wikidata_no_match_at
// comment) but never writes genre/location/website itself: the response
// is just data for ArtistForm to show a Scout, who decides whether to Fill
// + Save. A null match is a normal 200, not an error — absence of a
// Wikidata entry is the expected outcome for most artists this small.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const user = await getInternalUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const id = Number(params.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const artist = getArtist(id);
  if (!artist) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const result = await findWikidataMatch(artist.name);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });

  if (result.data) saveWikidataMatch(id, result.data.qid);
  else saveWikidataNoMatch(id);

  return NextResponse.json({ match: result.data });
}
