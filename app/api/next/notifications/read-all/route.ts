import { NextResponse } from 'next/server';
import { markNotificationsRead } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (!Array.isArray(body.keys) || !body.keys.every((k: unknown) => typeof k === 'string')) {
    return NextResponse.json({ error: 'keys must be an array of strings' }, { status: 400 });
  }

  markNotificationsRead(user.id, body.keys);
  return NextResponse.json({ ok: true });
}
