import { NextResponse } from 'next/server';
import { deleteArtist, getArtist, updateArtist } from '@/lib/db';
import { ArtistInput } from '@/lib/types';

export const dynamic = 'force-dynamic';

function parseId(idParam: string) {
  const id = Number(idParam);
  return Number.isInteger(id) ? id : null;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = parseId(params.id);
  if (id === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const artist = getArtist(id);
  if (!artist) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(artist);
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const id = parseId(params.id);
  if (id === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const body = (await req.json()) as ArtistInput;
  const artist = updateArtist(id, body);
  if (!artist) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(artist);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const id = parseId(params.id);
  if (id === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const ok = deleteArtist(id);
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
