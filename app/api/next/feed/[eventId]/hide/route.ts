import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { hideFeedEvent } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Hide one Feed item for this player only.
export async function POST(_req: Request, props: { params: Promise<{ eventId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const id = Number((await props.params).eventId);
  if (!Number.isInteger(id) || !(await hideFeedEvent(user.id, id))) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
