import { NextResponse } from 'next/server';
import { getInternalUser } from '@/lib/auth';
import { completeSyncRun, createSyncRun, getArtistsMissingTopSong, updateArtist } from '@/lib/db';
import { getAccessToken, getTopSongForArtist, spotifyConfigured } from '@/lib/spotify';
import { ArtistInput } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Same dual-auth pattern as /api/soundcharts/sync: a logged-in internal
// session (a manual "Sync Spotify top songs" button), or the shared
// CRON_SECRET for an external scheduler. Reuses CRON_SECRET rather than
// inventing a second secret — one scheduler can hit both endpoints.
async function isAuthorized(req: Request): Promise<boolean> {
  const user = await getInternalUser();
  if (user) return true;
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get('x-cron-secret') === secret;
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (!spotifyConfigured()) {
    return NextResponse.json({ error: 'Spotify is not configured on this server (set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET).' }, { status: 503 });
  }

  const run = createSyncRun('spotify');
  // Unlike Soundcharts sync, this covers the whole roster (Spotify lookup
  // is by artist name, not a stored id) but only artists still missing a
  // top song — see getArtistsMissingTopSong for why it never overwrites.
  const artists = getArtistsMissingTopSong();
  let updatedCount = 0;
  let noMatchCount = 0;
  let errorCount = 0;
  let lastError: string | undefined;

  try {
    // Verify credentials ONCE before looping — a bad client id/secret
    // should surface as one clear error, not N silent "no match"
    // failures with no explanation (same fix already made for the
    // YouTube scan's API key).
    const authCheck = await getAccessToken();
    if (!authCheck.ok) throw new Error(authCheck.error);

    for (const artist of artists) {
      const result = await getTopSongForArtist(artist.name, artist.spotify_url);
      if (!result.ok) {
        // 'no_artist_match'/'no_top_track' mean the calls succeeded and
        // genuinely found nothing (real for a fake/demo artist name —
        // but worth knowing separately from an actual API failure for a
        // real one). 'search_failed'/'top_track_lookup_failed' mean
        // something actually broke.
        if (result.reason === 'no_artist_match' || result.reason === 'no_top_track') {
          noMatchCount++;
        } else {
          errorCount++;
          lastError = result.error;
          console.error('[spotify-sync] lookup failed for', artist.name, result.reason, result.error);
        }
        continue;
      }
      // Same as the Soundcharts sync route: updateArtist only writes
      // fields present in the object — ArtistInput's required `name` is a
      // create-time constraint that doesn't apply to a partial update.
      updateArtist(artist.id, result.data as ArtistInput);
      updatedCount++;
    }

    const failedCount = noMatchCount + errorCount;
    completeSyncRun(run.id, { status: 'completed', checkedCount: artists.length, updatedCount, failedCount, noMatchCount, errorCount, lastError });
    return NextResponse.json({ runId: run.id, checked: artists.length, updated: updatedCount, noMatch: noMatchCount, errors: errorCount, lastError });
  } catch (err: any) {
    const message = err?.message ?? 'Unknown error during Spotify sync.';
    const failedCount = noMatchCount + errorCount;
    completeSyncRun(run.id, { status: 'failed', checkedCount: artists.length, updatedCount, failedCount, error: message, noMatchCount, errorCount, lastError });
    return NextResponse.json({ error: message, runId: run.id }, { status: 500 });
  }
}
