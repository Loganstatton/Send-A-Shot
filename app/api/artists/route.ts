import { NextResponse } from 'next/server';
import { createArtist, getAllArtists } from '@/lib/db';
import { getInternalUser } from '@/lib/auth';
import { ArtistInput } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getInternalUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(getAllArtists());
}

export async function POST(req: Request) {
  const user = await getInternalUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await req.json()) as ArtistInput;
  if (!body.name || !body.name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  const artist = createArtist(body, user);
  return NextResponse.json(artist, { status: 201 });
}
