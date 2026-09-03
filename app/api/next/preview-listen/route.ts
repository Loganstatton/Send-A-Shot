import { NextResponse } from 'next/server';
import { z } from 'zod';
import { recordPreviewListen } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const schema = z.object({
  artistId: z.number().int().positive(),
  event: z.enum(['started', 'completed']),
});

// Fired by YouTubePreviewButton (components/next/YouTubePreviewButton.tsx)
// when a Scout-attached YouTube preview opens — feeds "listened before buy"
// trade attribution (see hasListenedToArtist in lib/db.ts). Best-effort by
// design from the caller's side — a failed beacon here should never block
// anything. Pre-beta migration: this used to be fired by a shared
// Deezer-preview-mp3 mini-player (components/next/NowPlayingProvider.tsx,
// removed — nothing called it anymore once the Deezer <audio> preview was
// replaced by the compliant YouTube embed). Only 'started' is sent today;
// 'completed' predates that removal and has no live caller, but is kept as
// a valid, harmless input rather than narrowing the schema for no reason.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input.' }, { status: 400 });

  recordPreviewListen(user.id, parsed.data.artistId, parsed.data.event);
  return NextResponse.json({ ok: true });
}
