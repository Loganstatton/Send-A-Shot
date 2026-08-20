import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createUser, getUserByEmail } from '@/lib/db';
import { hashPassword, setSessionCookie } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  password: z.string().min(8).max(200),
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Name, a valid email, and a password of at least 8 characters are required.' }, { status: 400 });
  }
  const { name, email, password } = parsed.data;

  if (getUserByEmail(email)) {
    return NextResponse.json({ error: 'An account with that email already exists.' }, { status: 409 });
  }

  const password_hash = await hashPassword(password);
  const user = createUser({ name, email, password_hash });
  setSessionCookie(user.id);
  return NextResponse.json(user, { status: 201 });
}
