import { NextResponse } from 'next/server';
import { createArtist, getAllArtists } from '@/lib/db';
import { ArtistInput } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(getAllArtists());
}

export async function POST(req: Request) {
  const body = (await req.json()) as ArtistInput;
  if (!body.name || !body.name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  const artist = createArtist(body);
  return NextResponse.json(artist, { status: 201 });
}
