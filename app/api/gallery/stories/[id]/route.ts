import { NextResponse } from 'next/server';
import { deleteStory } from '@/lib/gallery/db';
import { getGalleryAdminOrNull } from '@/lib/gallery/auth';

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const admin = await getGalleryAdminOrNull();
  if (!admin) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });
  deleteStory(Number(params.id));
  return NextResponse.json({ ok: true });
}
