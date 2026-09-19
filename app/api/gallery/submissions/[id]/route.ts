import { NextResponse } from 'next/server';
import { updateSubmissionStatus } from '@/lib/gallery/db';
import { getGalleryAdminOrNull } from '@/lib/gallery/auth';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const admin = await getGalleryAdminOrNull();
  if (!admin) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const status = body?.status;
  if (!['new', 'reviewed', 'used'].includes(status)) return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });

  updateSubmissionStatus(Number(params.id), status);
  return NextResponse.json({ ok: true });
}
