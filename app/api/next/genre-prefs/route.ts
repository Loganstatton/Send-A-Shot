import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { logEvent } from '@/lib/db';
import { cleanGenrePrefs, getGenreOptions, setGenrePrefs } from '@/lib/genre-prefs';

export const dynamic = 'force-dynamic';

// Save the genres a player listens to (from onboarding or Settings). An
// empty list clears them.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const cleaned = cleanGenrePrefs(body?.genres, await getGenreOptions());
  if (!cleaned.ok) return NextResponse.json({ error: cleaned.error }, { status: 400 });

  await setGenrePrefs(user.id, cleaned.genres);
  await logEvent(user.id, 'genre_prefs_saved', { count: cleaned.genres.length, source: body?.source === 'settings' ? 'settings' : 'onboarding' });
  return NextResponse.json({ genres: cleaned.genres });
}
