import { NextResponse } from 'next/server';
import { deleteSymbolism } from '@/lib/gallery/db';
import { getGalleryAdminOrNull } from '@/lib/gallery/auth';

export async function DELETE(_req: Request, { params }: { params: { hotspotId: string } }) {
  const admin = await getGalleryAdminOrNull();
  if (!admin) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });
  deleteSymbolism(Number(params.hotspotId));
  return NextResponse.json({ ok: true });
}
