import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserByEmail } from '@/lib/db';
import { createActionToken } from '@/lib/auth';
import { sendEmail } from '@/lib/email';
import { resetPasswordMessage } from '@/lib/email-templates';
import { clientIp, recordAttempt, resetEmailBlocked } from '@/lib/login-guard';

export const dynamic = 'force-dynamic';

const RESET_TOKEN_TTL_SEC = 60 * 60; // 1h
const schema = z.object({ email: z.string().trim().email().max(200) });

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });

  // At most a few reset emails per address per hour, so this can't be used
  // to flood someone's inbox. Same response either way.
  const blocked = await resetEmailBlocked(parsed.data.email);
  await recordAttempt('reset', parsed.data.email, clientIp(req.headers), !blocked);
  const user = blocked ? undefined : await getUserByEmail(parsed.data.email);
  // Always the same response whether or not the account exists — a
  // different message here would let anyone probe which emails have
  // accounts on this app.
  if (user) {
    const token = await createActionToken(user.id, 'reset-password', RESET_TOKEN_TTL_SEC, user.password_hash);
    const appUrl = process.env.APP_URL ?? new URL(req.url).origin;
    // Not awaited: waiting would make the response slower for real
    // accounts than for unknown emails, revealing which exist. sendEmail
    // retries and records the outcome either way.
    sendEmail({ to: user.email, ...resetPasswordMessage(appUrl, token), kind: 'reset', userId: user.id }).catch((err) => console.error('[forgot-password] email failed to send', err?.message));
  }

  return NextResponse.json({ ok: true, message: 'If an account exists for that email, a reset link is on its way.' });
}
