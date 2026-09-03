import { NextResponse } from 'next/server';
import { getArtist, setArtistPhotoByOwner } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Lets a verified artist submit their own profile photo — the migration
// brief's "any uploaded image/media requires an explicit rights-
// confirmation checkbox" (item 3/33). This app has no binary file-upload
// storage anywhere (user avatars are also just a URL — see users.avatar_url
// in app/api/account/route.ts) and adding one is out of scope for a
// zero-cost pre-beta migration, so "upload" here means the artist supplies
// a direct link to an image they host themselves; the rights-confirmation
// checkbox, uploader id, and both timestamps are still stored exactly as
// the brief specifies (see setArtistPhotoByOwner in lib/db.ts).
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const id = Number(params.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const artist = getArtist(id);
  if (!artist || artist.claimed_by_user_id !== user.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const photoUrl = typeof body?.photoUrl === 'string' ? body.photoUrl.trim() : '';
  const rightsConfirmed = body?.rightsConfirmed === true;

  if (!photoUrl) return NextResponse.json({ error: 'photoUrl is required' }, { status: 400 });
  let parsed: URL;
  try {
    parsed = new URL(photoUrl);
  } catch {
    return NextResponse.json({ error: 'photoUrl must be a valid URL' }, { status: 400 });
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return NextResponse.json({ error: 'photoUrl must be http(s)' }, { status: 400 });
  }
  if (!rightsConfirmed) {
    return NextResponse.json({ error: 'You must confirm you own this content or have permission to provide it for use on NEXT.' }, { status: 400 });
  }

  const updated = setArtistPhotoByOwner(id, photoUrl, user.id);
  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true, photo_url: updated.photo_url });
}
