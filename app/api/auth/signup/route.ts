import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createUser, findUserByNormalizedEmail, getUserByEmail, logEvent } from '@/lib/db';
import { createActionToken, hashPassword, setSessionCookie } from '@/lib/auth';
import { sendEmail } from '@/lib/email';
import { verifyEmailMessage } from '@/lib/email-templates';
import { isUniqueViolation } from '@/lib/pg';
import { classifySignupSource } from '@/lib/attribution';

export const dynamic = 'force-dynamic';

const VERIFY_TOKEN_TTL_SEC = 24 * 60 * 60; // 24h

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  password: z.string().min(8).max(200),
  tosAccepted: z.literal(true),
  privacyAccepted: z.literal(true),
  inviteCode: z.string().trim().max(200).optional(),
  // The page the player is sent back to after signing up — used only to
  // record which part of NEXT the signup came from (lib/attribution.ts).
  returnTo: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const missedPolicy = parsed.error.issues.some((i) => i.path[0] === 'tosAccepted' || i.path[0] === 'privacyAccepted');
    return NextResponse.json(
      { error: missedPolicy ? 'You must accept the Terms of Service and Privacy Policy to sign up.' : 'Name, a valid email, and a password of at least 8 characters are required.' },
      { status: 400 }
    );
  }
  const { name, email, password, inviteCode, returnTo } = parsed.data;

  // Closed-beta gate: unset (the default) means open signup. Set it in
  // Render's Environment tab to switch to invite-only without a code
  // change — see components/AuthForm.tsx for the matching client prompt.
  const requiredInviteCode = process.env.SIGNUP_INVITE_CODE;
  if (requiredInviteCode && inviteCode !== requiredInviteCode) {
    return NextResponse.json({ error: 'That invite code is not valid.' }, { status: 403 });
  }

  if (await getUserByEmail(email)) {
    return NextResponse.json({ error: 'An account with that email already exists.' }, { status: 409 });
  }
  // Same message as the exact-match check above — this catches the most
  // common trivial-alias trick (a Gmail dot variant, a +tag) someone might
  // use to spin up a second account, but there's no reason to reveal to
  // the caller WHICH check caught it. See findUserByNormalizedEmail's own
  // comment for what this can't catch.
  if (await findUserByNormalizedEmail(email)) {
    return NextResponse.json({ error: 'An account with that email already exists.' }, { status: 409 });
  }

  const password_hash = await hashPassword(password);
  let user;
  try {
    user = await createUser({ name, email, password_hash });
  } catch (err) {
    // Two signups for the same address arriving together both pass the
    // checks above; the unique index on email lets exactly one through.
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: 'An account with that email already exists.' }, { status: 409 });
    }
    throw err;
  }
  await setSessionCookie(user.id);
  await logEvent(user.id, 'signup_completed', classifySignupSource(returnTo));

  // Never blocks account creation. sendEmail retries and records the
  // outcome (admin Email page); unconfigured, it prints the link in dev.
  const verifyToken = await createActionToken(user.id, 'verify-email', VERIFY_TOKEN_TTL_SEC);
  const appUrl = process.env.APP_URL ?? new URL(req.url).origin;
  sendEmail({ to: user.email, ...verifyEmailMessage(appUrl, verifyToken), kind: 'verify', userId: user.id }).catch((err) => console.error('[signup] verification email failed to send', err?.message));

  return NextResponse.json(user, { status: 201 });
}
