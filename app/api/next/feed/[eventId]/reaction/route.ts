import { NextResponse } from 'next/server';
import {
  getFeedEvent, getFeedReactionCounts, getRecentReactionCount, REACTION_RATE_LIMIT_PER_MINUTE, setFeedReaction,
} from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { ReactionType } from '@/lib/types';

export const dynamic = 'force-dynamic';

const VALID_TYPES: ReactionType[] = ['fire', 'eyes', 'early'];

// Toggle semantics: POSTing the reaction you already have removes it;
// POSTing a different one changes it; there's no separate DELETE route —
// see setFeedReaction's own comment in lib/db.ts.
export async function POST(req: Request, { params }: { params: { eventId: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const eventId = Number(params.eventId);
  if (!Number.isInteger(eventId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  if (!getFeedEvent(eventId)) return NextResponse.json({ error: 'feed item not found' }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!VALID_TYPES.includes(body?.reactionType)) {
    return NextResponse.json({ error: `reactionType must be one of ${VALID_TYPES.join(', ')}` }, { status: 400 });
  }

  if (getRecentReactionCount(user.id, 1) >= REACTION_RATE_LIMIT_PER_MINUTE) {
    return NextResponse.json({ error: "You're reacting faster than we can keep up — wait a moment and try again." }, { status: 429 });
  }

  const reaction = setFeedReaction(eventId, user.id, body.reactionType as ReactionType);
  return NextResponse.json({ reaction: reaction?.reaction_type ?? null, counts: getFeedReactionCounts(eventId) });
}
