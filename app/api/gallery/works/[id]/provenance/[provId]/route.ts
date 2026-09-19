import { NextResponse } from 'next/server';
import { deleteProvenance } from '@/lib/gallery/db';
import { getGalleryAdminOrNull } from '@/lib/gallery/auth';

export async function DELETE(_req: Request, { params }: { params: { provId: string } }) {
  const admin = await getGalleryAdminOrNull();
  if (!admin) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });
  deleteProvenance(Number(params.provId));
  return NextResponse.json({ ok: true });
}
