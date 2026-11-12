import { NextResponse } from 'next/server';
import { getSessionUser, createActionToken } from '@/lib/auth';
import { sendEmail } from '@/lib/email';
import { verifyEmailMessage } from '@/lib/email-templates';
import { db } from '@/lib/pg';

export const dynamic = 'force-dynamic';

const VERIFY_TOKEN_TTL_SEC = 24 * 60 * 60;
const RESENDS_PER_HOUR = 3;

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (user.email_verified_at) return NextResponse.json({ ok: true, alreadyVerified: true });

  // A few per hour, so repeated clicks can't flood an inbox or use up the
  // daily sending cap that everyone's password resets depend on.
  const since = new Date(Date.now() - 3600_000).toISOString();
  const recent = (await db.prepare("SELECT COUNT(*) AS n FROM email_log WHERE user_id = ? AND kind = 'verify' AND created_at >= ?").get(user.id, since)) as { n: number };
  if (Number(recent.n) >= RESENDS_PER_HOUR) {
    return NextResponse.json({ error: 'A verification email was sent recently — check your inbox and spam folder, or try again in an hour.' }, { status: 429 });
  }

  const token = await createActionToken(user.id, 'verify-email', VERIFY_TOKEN_TTL_SEC);
  const appUrl = process.env.APP_URL ?? new URL(req.url).origin;
  const result = await sendEmail({ to: user.email, ...verifyEmailMessage(appUrl, token), kind: 'verify', userId: user.id });

  return NextResponse.json({ ok: true, delivered: result.ok });
}
