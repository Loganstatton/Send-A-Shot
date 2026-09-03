import { NextResponse } from 'next/server';
import { getArtist, updateArtistByOwner } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { ArtistInput } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Lets a verified artist (artists.claimed_by_user_id === them) edit their
// own profile — bio, genre, location, official website, and their own
// platform links/featured video (see CLAIMED_ARTIST_EDITABLE_FIELDS in
// lib/db.ts for the exact whitelist and what's deliberately excluded:
// Scout notes, scoring, stage, internal discovery info, other users'
// activity). Same shape as the existing note route
// (app/api/next/my-artist/[id]/note/route.ts) — same auth check, same
// "this is the only thing they can write here" scoping, just for profile
// fields instead of an activity-log note.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const id = Number(params.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const artist = getArtist(id);
  if (!artist || artist.claimed_by_user_id !== user.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  // updateArtistByOwner itself re-filters to CLAIMED_ARTIST_EDITABLE_FIELDS
  // — this trim is just to stop an unrelated key from ever reaching the
  // field-history diff logic with a value that was never actually applied.
  const allowed = ['bio', 'genre', 'location', 'website_url', 'tiktok_url', 'instagram_url', 'youtube_url', 'spotify_url', 'soundcloud_url', 'featured_video_id'];
  const input: Record<string, unknown> = {};
  for (const key of allowed) if (key in body) input[key] = typeof body[key] === 'string' ? body[key].trim() || null : body[key];

  const updated = updateArtistByOwner(id, input as ArtistInput, { id: user.id, name: user.name });
  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
