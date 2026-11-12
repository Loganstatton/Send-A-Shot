import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserByEmail, logEvent, recordLogin } from '@/lib/db';
import { hashPassword, setSessionCookie, verifyPassword } from '@/lib/auth';
import { clientIp, loginBlocked, pruneAttempts, recordAttempt, WINDOW_MIN } from '@/lib/login-guard';

export const dynamic = 'force-dynamic';

const schema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
});

// A hash to check against when the email has no account, so a login for an
// unknown email takes as long as a wrong password — otherwise response time
// alone would reveal which emails are registered.
let dummyHash: Promise<string> | null = null;

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
  }
  const { email, password } = parsed.data;
  const ip = clientIp(req.headers);

  if (await loginBlocked(email, ip)) {
    return NextResponse.json(
      { error: `Too many failed attempts. Wait ${WINDOW_MIN} minutes, or reset your password.` },
      { status: 429, headers: { 'Retry-After': String(WINDOW_MIN * 60) } },
    );
  }

  const user = await getUserByEmail(email);
  const ok = user
    ? await verifyPassword(password, user.password_hash)
    : (await verifyPassword(password, await (dummyHash ??= hashPassword('not-a-real-password-' + Math.random()))), false);
  await recordAttempt('login', email, ip, ok);
  if (Math.random() < 0.02) await pruneAttempts();
  if (!user || !ok) {
    return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
  }

  await setSessionCookie(user.id);
  const { returning } = await recordLogin(user.id);
  if (returning) await logEvent(user.id, 'session_returned');
  const { password_hash, ...publicUser } = user;
  return NextResponse.json(publicUser);
}
