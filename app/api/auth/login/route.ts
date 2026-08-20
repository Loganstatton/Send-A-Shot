import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserByEmail } from '@/lib/db';
import { setSessionCookie, verifyPassword } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const schema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
  }
  const { email, password } = parsed.data;

  const user = getUserByEmail(email);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
  }

  setSessionCookie(user.id);
  const { password_hash, ...publicUser } = user;
  return NextResponse.json(publicUser);
}
