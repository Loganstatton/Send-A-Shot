import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserByEmail } from '@/lib/db';
import { createActionToken } from '@/lib/auth';
import { sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

const RESET_TOKEN_TTL_SEC = 60 * 60; // 1h
const schema = z.object({ email: z.string().trim().email().max(200) });

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });

  const user = getUserByEmail(parsed.data.email);
  // Always the same response whether or not the account exists — a
  // different message here would let anyone probe which emails have
  // accounts on this app.
  if (user) {
    const token = createActionToken(user.id, 'reset-password', RESET_TOKEN_TTL_SEC, user.password_hash);
    const appUrl = process.env.APP_URL ?? new URL(req.url).origin;
    sendEmail({
      to: user.email,
      subject: 'Reset your Send-A-Shot password',
      html: `<p>Reset your password — this link expires in 1 hour and stops working as soon as it's used.</p><p><a href="${appUrl}/reset-password?token=${token}">Reset password</a></p><p>If you didn't request this, you can ignore this email.</p>`,
    }).catch((err) => console.error('[forgot-password] email failed to send', err?.message));
  }

  return NextResponse.json({ ok: true, message: 'If an account exists for that email, a reset link is on its way.' });
}
