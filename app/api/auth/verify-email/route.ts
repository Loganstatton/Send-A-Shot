import { NextResponse } from 'next/server';
import { z } from 'zod';
import { markEmailVerified } from '@/lib/db';
import { verifyActionToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const schema = z.object({ token: z.string().min(1) });

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Missing token.' }, { status: 400 });

  const result = verifyActionToken(parsed.data.token, 'verify-email');
  if (!result) return NextResponse.json({ error: 'This verification link is invalid or has expired.' }, { status: 400 });

  const user = markEmailVerified(result.uid);
  if (!user) return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
  return NextResponse.json(user);
}
