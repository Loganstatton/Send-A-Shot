import { NextResponse } from 'next/server';
import { hideUserTakePost, unhideUserTakePost } from '@/lib/db';
import { getInternalUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Internal-only moderation action — see app/admin/feed-reports/page.tsx,
// the one place this is actually called from. getInternalUser (not
// requireInternal) since this is a route handler, not a page — a route
// should 401 with JSON for a fetch() caller, not throw a page redirect.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const admin = await getInternalUser();
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const id = Number(params.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const hidden = hideUserTakePost(admin.id, id);
  return NextResponse.json({ ok: hidden });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const admin = await getInternalUser();
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const id = Number(params.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const unhidden = unhideUserTakePost(id);
  return NextResponse.json({ ok: unhidden });
}
