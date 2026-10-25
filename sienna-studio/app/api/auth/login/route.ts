import { NextResponse } from 'next/server';
import { AUTH_COOKIE, authEnabled, checkPassword, createSessionToken, SESSION_DAYS } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Brute-force guard: the 400 ms delay alone let parallel requests guess freely. Wrong passwords are counted per
// client address and in total; after too many in 15 minutes, sign-in waits.
const WINDOW_MS = 15 * 60_000;
const MAX_PER_IP = 10;
const MAX_TOTAL = 50;
const g = globalThis as unknown as { __siennaLoginFails?: { at: number; ip: string }[] };
const fails = (g.__siennaLoginFails ??= []);

function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
}

export async function POST(req: Request) {
  if (!authEnabled()) return NextResponse.json({ ok: true });
  const body = (await req.json().catch(() => null)) as { password?: unknown } | null;
  const password = body && typeof body === 'object' && typeof body.password === 'string' ? body.password : '';
  const ip = clientIp(req);
  const now = Date.now();
  while (fails.length && now - fails[0].at > WINDOW_MS) fails.shift();
  if (fails.filter((f) => f.ip === ip).length >= MAX_PER_IP || fails.length >= MAX_TOTAL) {
    return NextResponse.json({ error: 'Too many wrong passwords — wait 15 minutes and try again.' }, { status: 429 });
  }
  // Small delay blunts brute-force attempts.
  await new Promise((r) => setTimeout(r, 400));
  if (!password || !(await checkPassword(password))) {
    fails.push({ at: now, ip });
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
