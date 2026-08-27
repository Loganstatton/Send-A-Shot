import { NextResponse } from 'next/server';
import { createUserTakePost, getRecentUserTakePostCount, logEvent, USER_TAKE_RATE_LIMIT_PER_10_MIN } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Creates a User Take — the one Feed post type any authenticated NEXT user
// can write, distinct from Artist Update (posted by the claimed artist
// through app/api/next/my-artist/[id]/note/route.ts — never merged with
// this identity). Auth + rate limiting live here, matching every other
// Feed-writing route's split; the actual validation (empty/length/valid
// artist/duplicate-guard) lives in createUserTakePost itself.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (getRecentUserTakePostCount(user.id, 10) >= USER_TAKE_RATE_LIMIT_PER_10_MIN) {
    return NextResponse.json({ error: "You're posting faster than we can keep up — wait a few minutes and try again." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const artistId = Number(body?.artistId);
  const text = typeof body?.body === 'string' ? body.body : '';
  if (!Number.isInteger(artistId)) return NextResponse.json({ error: 'artistId is required' }, { status: 400 });

  const result = createUserTakePost(user.id, artistId, text);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  logEvent(user.id, 'feed_user_post_created', { artistId, feedEventId: result.event.id, postId: result.post.id });
  return NextResponse.json({ post: result.post, event: result.event }, { status: 201 });
}
