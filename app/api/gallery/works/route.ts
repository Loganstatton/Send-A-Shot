import { NextResponse } from 'next/server';
import { createArtwork, listArtworks } from '@/lib/gallery/db';
import { getGalleryAdminOrNull } from '@/lib/gallery/auth';

export async function GET() {
  const admin = await getGalleryAdminOrNull();
  if (!admin) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });
  return NextResponse.json({ artworks: listArtworks({ includeUnpublished: true, includeUnreleased: true }) });
}

export async function POST(req: Request) {
  const admin = await getGalleryAdminOrNull();
  if (!admin) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const title = body?.title;
  const year = Number(body?.year);
  if (typeof title !== 'string' || !title.trim()) return NextResponse.json({ error: 'Title is required.' }, { status: 400 });
  if (!Number.isFinite(year)) return NextResponse.json({ error: 'A valid year is required.' }, { status: 400 });

  const artwork = createArtwork({ title: title.trim(), year, is_published: false });
  return NextResponse.json({ artwork });
}
