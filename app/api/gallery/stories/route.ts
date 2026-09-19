import { NextResponse } from 'next/server';
import { createStory, listStories } from '@/lib/gallery/db';
import { getGalleryAdminOrNull } from '@/lib/gallery/auth';

export async function GET() {
  const admin = await getGalleryAdminOrNull();
  if (!admin) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });
  return NextResponse.json({ stories: listStories({ includeUnpublished: true }) });
}

export async function POST(req: Request) {
  const admin = await getGalleryAdminOrNull();
  if (!admin) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (typeof body?.title !== 'string' || !body.title.trim()) return NextResponse.json({ error: 'Title is required.' }, { status: 400 });

  const story = createStory({
    title: body.title.trim(),
    dek: typeof body.dek === 'string' ? body.dek.trim() : '',
    body: typeof body.body === 'string' ? body.body.trim() : '',
    cover_image_url: typeof body.cover_image_url === 'string' ? body.cover_image_url : null,
    is_published: body.is_published !== false,
  });
  return NextResponse.json({ story });
}
