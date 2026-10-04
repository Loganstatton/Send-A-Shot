import { NextResponse } from 'next/server';
import { AUTH_COOKIE, authEnabled, checkPassword, createSessionToken, SESSION_DAYS } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!authEnabled()) return NextResponse.json({ ok: true });
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  // Small delay blunts brute-force attempts.
  await new Promise((r) => setTimeout(r, 400));
  if (!password || !(await checkPassword(password))) {
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, await createSessionToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIES !== 'true',
    path: '/',
    maxAge: SESSION_DAYS * 86400,
  });
  return res;
}
