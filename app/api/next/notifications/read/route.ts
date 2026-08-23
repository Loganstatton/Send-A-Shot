import { NextResponse } from 'next/server';
import { markNotificationRead } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (typeof body.key !== 'string' || !body.key) return NextResponse.json({ error: 'key is required' }, { status: 400 });

  markNotificationRead(user.id, body.key);
  return NextResponse.json({ ok: true });
}
