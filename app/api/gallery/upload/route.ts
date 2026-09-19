import { NextResponse } from 'next/server';
import { getGalleryAdminOrNull } from '@/lib/gallery/auth';
import { saveBase64Image } from '@/lib/gallery/upload';

const ALLOWED_SUBDIRS = ['artworks', 'stories'];

export async function POST(req: Request) {
  const admin = await getGalleryAdminOrNull();
  if (!admin) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const subdir = ALLOWED_SUBDIRS.includes(body?.subdir) ? body.subdir : 'artworks';
  if (typeof body?.data_url !== 'string') return NextResponse.json({ error: 'Missing image data.' }, { status: 400 });

  try {
    const saved = saveBase64Image(body.data_url, subdir);
    return NextResponse.json(saved);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Upload failed.' }, { status: 400 });
  }
}
