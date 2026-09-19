import { NextResponse } from 'next/server';
import { addSymbolism } from '@/lib/gallery/db';
import { getGalleryAdminOrNull } from '@/lib/gallery/auth';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const admin = await getGalleryAdminOrNull();
  if (!admin) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (typeof body?.label !== 'string' || !body.label.trim()) return NextResponse.json({ error: 'Label is required.' }, { status: 400 });
  if (typeof body?.description !== 'string' || !body.description.trim()) return NextResponse.json({ error: 'Description is required.' }, { status: 400 });

  const hotspot = addSymbolism(Number(params.id), {
    label: body.label.trim().slice(0, 120),
    description: body.description.trim().slice(0, 600),
    x_pct: Math.max(0, Math.min(100, Number(body.x_pct) || 50)),
    y_pct: Math.max(0, Math.min(100, Number(body.y_pct) || 50)),
  });
  return NextResponse.json({ hotspot });
}
