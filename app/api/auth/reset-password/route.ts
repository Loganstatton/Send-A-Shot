import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserById, getUserPasswordHash, updateUserPasswordHash } from '@/lib/db';
import { hashPassword, setSessionCookie, verifyActionToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const schema = z.object({ token: z.string().min(1), password: z.string().min(8).max(200) });

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'A token and a password of at least 8 characters are required.' }, { status: 400 });
  }
  const { token, password } = parsed.data;

  // The token embeds a fingerprint of the CURRENT password hash (see
  // createActionToken) — reading it before verifying is what makes an
  // already-used reset link self-invalidate: once the hash below changes,
  // this same token's fingerprint no longer matches.
  const uidGuess = decodeUid(token);
  const currentHash = uidGuess ? getUserPasswordHash(uidGuess) : undefined;
  const result = verifyActionToken(token, 'reset-password', currentHash);
  if (!result) return NextResponse.json({ error: 'This reset link is invalid, expired, or already used.' }, { status: 400 });

  const password_hash = await hashPassword(password);
  updateUserPasswordHash(result.uid, password_hash);

  const user = getUserById(result.uid);
  if (user) setSessionCookie(user.id); // convenience: log them straight in after a successful reset
  return NextResponse.json({ ok: true });
}

// Peeks at the token's claimed uid without trusting it — verifyActionToken
// still does the real signature/expiry/fingerprint check right after.
// Needed because looking up "the current password hash" requires knowing
// which user before the token can be verified.
function decodeUid(token: string): number | null {
  const [body] = token.split('.');
  if (!body) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return typeof payload.uid === 'number' ? payload.uid : null;
  } catch {
    return null;
  }
}
