import { NextResponse } from 'next/server';
import { getUserTakePostById, logEvent, reportUserTakePost } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// One report per (post, reporter) — a second report from the same person
// is a no-op (reportUserTakePost's own UNIQUE-index INSERT OR IGNORE), so
// this route always returns success rather than erroring on a repeat tap.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const id = Number(params.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  if (!getUserTakePostById(id)) return NextResponse.json({ error: 'not found' }, { status: 404 });

  reportUserTakePost(user.id, id);
  logEvent(user.id, 'feed_user_post_reported', { postId: id });
  return NextResponse.json({ ok: true });
}
