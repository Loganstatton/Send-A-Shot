import { NextResponse } from 'next/server';
import { deleteArtworkImage } from '@/lib/gallery/db';
import { getGalleryAdminOrNull } from '@/lib/gallery/auth';

export async function DELETE(_req: Request, { params }: { params: { imageId: string } }) {
  const admin = await getGalleryAdminOrNull();
  if (!admin) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });
  deleteArtworkImage(Number(params.imageId));
  return NextResponse.json({ ok: true });
}
