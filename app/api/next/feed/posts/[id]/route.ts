import { NextResponse } from 'next/server';
import { deleteUserTakePost, logEvent } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Soft-delete — only the author may do this. deleteUserTakePost's own
// WHERE clause (id + user_id + not already deleted) makes ownership
// enforcement atomic rather than a separate read-then-check.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const id = Number(params.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const deleted = deleteUserTakePost(user.id, id);
  if (!deleted) return NextResponse.json({ error: 'not found, already deleted, or not yours' }, { status: 404 });

  logEvent(user.id, 'feed_user_post_deleted', { postId: id });
  return NextResponse.json({ ok: true });
}
