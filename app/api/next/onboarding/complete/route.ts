import { NextResponse } from 'next/server';
import { completeNextOnboarding } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Any logged-in user (public, internal, or admin) can dismiss/finish their
// own NEXT walkthrough — not gated to public users only, since an internal
// Scout using NEXT as a trader sees the same first-login flow.
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const updated = completeNextOnboarding(user.id);
  return NextResponse.json(updated ?? user);
}
