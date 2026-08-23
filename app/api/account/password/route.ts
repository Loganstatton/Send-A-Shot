import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserPasswordHash, updateUserPasswordHash } from '@/lib/db';
import { getSessionUser, hashPassword, verifyPassword } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Current password and a new password of at least 8 characters are required.' }, { status: 400 });

  const currentHash = getUserPasswordHash(user.id);
  if (!currentHash || !(await verifyPassword(parsed.data.currentPassword, currentHash))) {
    return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 401 });
  }

  const newHash = await hashPassword(parsed.data.newPassword);
  updateUserPasswordHash(user.id, newHash);
  return NextResponse.json({ ok: true });
}
