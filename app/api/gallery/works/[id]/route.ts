import { NextResponse } from 'next/server';
import { deleteArtwork, getArtworkById, getArtworkFull, updateArtwork } from '@/lib/gallery/db';
import { getGalleryAdminOrNull } from '@/lib/gallery/auth';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const admin = await getGalleryAdminOrNull();
  if (!admin) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });
  const artwork = getArtworkById(Number(params.id));
  if (!artwork) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json({ artwork: getArtworkFull(artwork) });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const admin = await getGalleryAdminOrNull();
  if (!admin) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });

  const artwork = updateArtwork(Number(params.id), body);
  if (!artwork) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json({ artwork });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const admin = await getGalleryAdminOrNull();
  if (!admin) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });
  deleteArtwork(Number(params.id));
  return NextResponse.json({ ok: true });
}
