import { NextResponse } from 'next/server';
import { updateInquiryStatus } from '@/lib/gallery/db';
import { getGalleryAdminOrNull } from '@/lib/gallery/auth';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const admin = await getGalleryAdminOrNull();
  if (!admin) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const status = body?.status;
  if (!['new', 'responded', 'closed'].includes(status)) {
    return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
  }
  updateInquiryStatus(Number(params.id), status);
  return NextResponse.json({ ok: true });
}
