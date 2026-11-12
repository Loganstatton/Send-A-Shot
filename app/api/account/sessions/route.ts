import { NextResponse } from 'next/server';
import { bumpSessionVersion } from '@/lib/db';
import { getSessionUser, setSessionCookie } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// "Log out of all other devices": ends every session except this one.
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  await bumpSessionVersion(user.id);
  await setSessionCookie(user.id);
  return NextResponse.json({ ok: true });
}
