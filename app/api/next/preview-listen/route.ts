import { NextResponse } from 'next/server';
import { z } from 'zod';
import { recordPreviewListen } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const schema = z.object({
  artistId: z.number().int().positive(),
  event: z.enum(['started', 'completed']),
});

// Fired by the mini-player (components/next/NowPlayingProvider.tsx) as
// preview playback starts/ends. Best-effort by design from the caller's
// side — a failed beacon here should never interrupt someone's music.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input.' }, { status: 400 });

  recordPreviewListen(user.id, parsed.data.artistId, parsed.data.event);
  return NextResponse.json({ ok: true });
}
