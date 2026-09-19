import { NextResponse } from 'next/server';
import { addArtworkImage } from '@/lib/gallery/db';
import { getGalleryAdminOrNull } from '@/lib/gallery/auth';
import { saveBase64Image } from '@/lib/gallery/upload';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const admin = await getGalleryAdminOrNull();
  if (!admin) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (typeof body?.data_url !== 'string') return NextResponse.json({ error: 'Missing image data.' }, { status: 400 });

  let url: string;
  try {
    url = saveBase64Image(body.data_url, 'artworks').url;
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Upload failed.' }, { status: 400 });
  }

  const image = addArtworkImage(Number(params.id), {
    url,
    alt: typeof body.alt === 'string' ? body.alt.slice(0, 300) : '',
    kind: body.kind ?? 'detail',
  });
  return NextResponse.json({ image });
}
