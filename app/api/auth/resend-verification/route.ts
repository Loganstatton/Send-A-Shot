import { NextResponse } from 'next/server';
import { getSessionUser, createActionToken } from '@/lib/auth';
import { sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

const VERIFY_TOKEN_TTL_SEC = 24 * 60 * 60;

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (user.email_verified_at) return NextResponse.json({ ok: true, alreadyVerified: true });

  const token = createActionToken(user.id, 'verify-email', VERIFY_TOKEN_TTL_SEC);
  const appUrl = process.env.APP_URL ?? new URL(req.url).origin;
  const result = await sendEmail({
    to: user.email,
    subject: 'Verify your email for Send-A-Shot',
    html: `<p>Confirm your email to finish setting up your account.</p><p><a href="${appUrl}/verify-email?token=${token}">Verify email</a></p><p>This link expires in 24 hours.</p>`,
  });

  return NextResponse.json({ ok: true, delivered: result.ok });
}
