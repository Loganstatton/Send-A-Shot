import { NextResponse } from 'next/server';
import { createSubmission, listSubmissions } from '@/lib/gallery/db';
import { getGalleryAdminOrNull } from '@/lib/gallery/auth';
import { saveBase64Image } from '@/lib/gallery/upload';
import { isHoneypotTripped, isRateLimited, requestIp } from '@/lib/gallery/spam';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });

  if (isHoneypotTripped(body.website)) return NextResponse.json({ ok: true });
  if (isRateLimited(`submission:${requestIp(req)}`, 3, 30 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again shortly.' }, { status: 429 });
  }

  const { name, story, permission_granted, photo_data_url } = body;
  if (typeof name !== 'string' || !name.trim()) return NextResponse.json({ error: 'Name is required.' }, { status: 400 });
  if (typeof story !== 'string' || story.trim().length < 10) return NextResponse.json({ error: 'Please share a bit more of the story.' }, { status: 400 });
  if (!permission_granted) return NextResponse.json({ error: 'Permission is required to submit.' }, { status: 400 });

  let photo_url: string | null = null;
  if (typeof photo_data_url === 'string' && photo_data_url) {
    try {
      photo_url = saveBase64Image(photo_data_url, 'submissions').url;
    } catch (err: any) {
      return NextResponse.json({ error: err.message ?? 'Could not process photo.' }, { status: 400 });
    }
  }

  const submission = createSubmission({
    name: name.trim().slice(0, 200),
    story: story.trim().slice(0, 6000),
    photo_url,
    permission_granted: true,
  });

  return NextResponse.json({ ok: true, id: submission.id });
}

export async function GET() {
  const admin = await getGalleryAdminOrNull();
  if (!admin) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });
  return NextResponse.json({ submissions: listSubmissions() });
}
