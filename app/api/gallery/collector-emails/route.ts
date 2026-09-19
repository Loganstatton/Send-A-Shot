import { NextResponse } from 'next/server';
import { addCollectorEmail, listCollectorEmails } from '@/lib/gallery/db';
import { getGalleryAdminOrNull } from '@/lib/gallery/auth';
import { isHoneypotTripped, isRateLimited, requestIp } from '@/lib/gallery/spam';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });

  if (isHoneypotTripped(body.website)) return NextResponse.json({ ok: true });
  if (isRateLimited(`collector-email:${requestIp(req)}`, 8, 10 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again shortly.' }, { status: 429 });
  }

  const email = body.email;
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
  }
  const source = typeof body.source === 'string' ? body.source.slice(0, 80) : 'private_releases';
  addCollectorEmail(email, source);
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const admin = await getGalleryAdminOrNull();
  if (!admin) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });
  return NextResponse.json({ emails: listCollectorEmails() });
}
