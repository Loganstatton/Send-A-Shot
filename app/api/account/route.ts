import { NextResponse } from 'next/server';
import { z } from 'zod';
import { deleteUser, updateUserProfile } from '@/lib/db';
import { clearSessionCookie, getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const schema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  avatar_url: z.string().trim().max(2000).nullable().optional(),
  show_positions_publicly: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input.' }, { status: 400 });

  const updated = updateUserProfile(user.id, parsed.data);
  return NextResponse.json(updated);
}

// Self-service account deletion. deleteUser cascades NEXT holdings/
// transactions/watchlist/founding-believer records for this user (see the
// comment on deleteUser in lib/db.ts) and clears the session immediately —
// there's no undo, so the client confirms before ever calling this.
export async function DELETE() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  deleteUser(user.id);
  clearSessionCookie();
  return NextResponse.json({ ok: true });
}
