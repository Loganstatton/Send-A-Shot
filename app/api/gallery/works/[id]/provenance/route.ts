import { NextResponse } from 'next/server';
import { addProvenance } from '@/lib/gallery/db';
import { getGalleryAdminOrNull } from '@/lib/gallery/auth';
import { ProvenanceKind } from '@/lib/gallery/types';

const VALID_KINDS: ProvenanceKind[] = ['exhibition', 'publication', 'award', 'ownership', 'gallery'];

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const admin = await getGalleryAdminOrNull();
  if (!admin) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!VALID_KINDS.includes(body?.kind)) return NextResponse.json({ error: 'Invalid kind.' }, { status: 400 });
  if (typeof body?.title !== 'string' || !body.title.trim()) return NextResponse.json({ error: 'Title is required.' }, { status: 400 });

  const entry = addProvenance(Number(params.id), {
    kind: body.kind,
    title: body.title.trim().slice(0, 300),
    detail: typeof body.detail === 'string' ? body.detail.trim().slice(0, 1000) : null,
    date_text: typeof body.date_text === 'string' ? body.date_text.trim().slice(0, 120) : null,
  });
  return NextResponse.json({ entry });
}
