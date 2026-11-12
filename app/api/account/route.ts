import { NextResponse } from 'next/server';
import { z } from 'zod';
import { deleteUser, updateUserProfile } from '@/lib/db';
import { clearSessionCookie, getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const schema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  avatar_url: z.string().trim().max(2000).nullable().optional(),
  show_positions_publicly: z.boolean().optional(),
  // Notification preferences (Settings → Notifications). These were missing
  // here before, so zod silently dropped them and the toggles never saved.
  notify_watchlist_moves: z.boolean().optional(),
  notify_new_artists: z.boolean().optional(),
  notify_founding_believer: z.boolean().optional(),
  notify_portfolio_milestones: z.boolean().optional(),
  notify_leaderboard_rank: z.boolean().optional(),
  notify_social: z.boolean().optional(),
  notify_challenges: z.boolean().optional(),
  email_notifications_enabled: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input.' }, { status: 400 });

  const updated = await updateUserProfile(user.id, parsed.data);
  return NextResponse.json(updated);
}

// Self-service account deletion. deleteUser cascades NEXT holdings/
// transactions/watchlist/founding-believer records for this user (see the
// comment on deleteUser in lib/db.ts) and clears the session immediately —
// there's no undo, so the client confirms before ever calling this.
export async function DELETE() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  await deleteUser(user.id);
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
