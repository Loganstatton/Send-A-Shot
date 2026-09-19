import { NextResponse } from 'next/server';
import { createInquiry, listInquiries } from '@/lib/gallery/db';
import { getGalleryAdminOrNull } from '@/lib/gallery/auth';
import { isHoneypotTripped, isRateLimited, requestIp } from '@/lib/gallery/spam';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });

  if (isHoneypotTripped(body.website)) {
    // Silently succeed — never tip off a bot that it was caught.
    return NextResponse.json({ ok: true });
  }
  if (isRateLimited(`inquiry:${requestIp(req)}`, 5, 10 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again shortly.' }, { status: 429 });
  }

  const { artwork_id, name, email, phone, country, message } = body;
  if (typeof name !== 'string' || !name.trim()) return NextResponse.json({ error: 'Name is required.' }, { status: 400 });
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
  if (typeof message !== 'string' || !message.trim()) return NextResponse.json({ error: 'Please include a short message.' }, { status: 400 });

  const inquiry = createInquiry({
    artwork_id: typeof artwork_id === 'number' ? artwork_id : null,
    name: name.trim().slice(0, 200),
    email: email.trim().slice(0, 320),
    phone: typeof phone === 'string' && phone.trim() ? phone.trim().slice(0, 60) : null,
    country: typeof country === 'string' && country.trim() ? country.trim().slice(0, 120) : null,
    message: message.trim().slice(0, 4000),
  });

  return NextResponse.json({ ok: true, id: inquiry.id });
}

export async function GET() {
  const admin = await getGalleryAdminOrNull();
  if (!admin) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });
  return NextResponse.json({ inquiries: listInquiries() });
}
