import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { AUTH_COOKIE, authEnabled, checkPassword, createDeviceToken, createSessionToken, DEVICE_COOKIE, DEVICE_DAYS, SESSION_DAYS, verifyDeviceToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Brute-force guard: the 400 ms delay alone let parallel requests guess freely. Attempts are counted per client
// address and in total from the moment they arrive (a burst can't all pass before the first failure is recorded);
// after too many wrong ones in 15 minutes, sign-in waits. A device that signed in before skips the total cap, so a
// stranger tripping it can't lock the owner out.
const WINDOW_MS = 15 * 60_000;
const MAX_PER_IP = 10;
const MAX_TOTAL = 50;
type Attempt = { at: number; ip: string };
const g = globalThis as unknown as { __siennaLoginFails?: Attempt[] };
const fails = (g.__siennaLoginFails ??= []);

/** The address the proxy saw. Cloudflare's / Render's own header first; otherwise the last X-Forwarded-For entry (the
 * one our proxy appended — the first is whatever the client sent). */
function clientIp(req: Request): string {
  const h = req.headers;
  const xff = (h.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return h.get('cf-connecting-ip') || h.get('true-client-ip') || xff[xff.length - 1] || h.get('x-real-ip') || 'unknown';
}

export async function POST(req: Request) {
  if (!authEnabled()) return NextResponse.json({ ok: true });
  const body = (await req.json().catch(() => null)) as { password?: unknown } | null;
  const password = body && typeof body === 'object' && typeof body.password === 'string' ? body.password : '';
  const ip = clientIp(req);
  const now = Date.now();
  while (fails.length && now - fails[0].at > WINDOW_MS) fails.shift();
  const knownDevice = await verifyDeviceToken(cookies().get(DEVICE_COOKIE)?.value);
  if (fails.filter((f) => f.ip === ip).length >= MAX_PER_IP || (!knownDevice && fails.length >= MAX_TOTAL)) {
    return NextResponse.json({ error: 'Too many wrong passwords — wait 15 minutes and try again.' }, { status: 429 });
  }
  // counted now, removed again if the password is right
  const attempt: Attempt = { at: now, ip };
  fails.push(attempt);
  // Small delay blunts brute-force attempts.
  await new Promise((r) => setTimeout(r, 400));
  if (!password || !(await checkPassword(password))) {
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 });
  }
  const i = fails.indexOf(attempt);
  if (i >= 0) fails.splice(i, 1);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, await createSessionToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIES !== 'true',
    path: '/',
    maxAge: SESSION_DAYS * 86400,
  });
  res.cookies.set(DEVICE_COOKIE, await createDeviceToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIES !== 'true',
    path: '/api/auth',
    maxAge: DEVICE_DAYS * 86400,
  });
  return res;
}
