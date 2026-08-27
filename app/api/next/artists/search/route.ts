import { NextResponse } from 'next/server';
import { searchNextArtists } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Backs the User Take composer's artist search — a small autocomplete
// dropdown, not a full Discover-style browse (see searchNextArtists' own
// comment on why findArtistsByName, the existing exact-match duplicate
// checker, isn't reusable here).
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const q = new URL(req.url).searchParams.get('q') ?? '';
  return NextResponse.json({ results: searchNextArtists(q) });
}
