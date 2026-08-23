import { NextResponse } from 'next/server';
import { getInternalUser } from '@/lib/auth';
import { completeSyncRun, createSyncRun, getArtistsMissingTopSong, logSyncFailure, stampSourceSyncedAt, updateArtist } from '@/lib/db';
import { getTopSongForArtist } from '@/lib/deezer';
import { withRetry } from '@/lib/retry';
import { ArtistInput } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Same dual-auth pattern as /api/soundcharts/sync: a logged-in internal
// session (a manual "Sync Deezer top songs" button), or the shared
// CRON_SECRET for an external scheduler.
async function isAuthorized(req: Request): Promise<boolean> {
  const user = await getInternalUser();
  if (user) return true;
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get('x-cron-secret') === secret;
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const run = createSyncRun('deezer');
  // Covers the whole roster (Deezer lookup is by artist name) but only
  // artists still missing a top song — see getArtistsMissingTopSong for
  // why it never overwrites.
  const artists = getArtistsMissingTopSong();
  let updatedCount = 0;
  let noMatchCount = 0;
  let errorCount = 0;
  let lastError: string | undefined;

  try {
    for (const artist of artists) {
      // One automatic retry before counting this artist as a real error —
      // see lib/retry.ts. Only wraps the failure path's cost, since a
      // successful first attempt never retries.
      const result = await withRetry(() => getTopSongForArtist(artist.name));
      if (!result.ok) {
        // 'no_artist_match'/'no_top_track' mean the calls succeeded and
        // genuinely found nothing. 'search_failed'/'top_track_lookup_failed'
        // mean something actually broke.
        if (result.reason === 'no_artist_match' || result.reason === 'no_top_track') {
          noMatchCount++;
          // A completed, honest check — even though it found nothing.
          stampSourceSyncedAt(artist.id, 'deezer');
          // Previously silent — made it impossible to tell which specific
          // artists (a famous one shouldn't ever land here) got "no match"
          // vs which genuinely have no Deezer presence, without guessing
          // from the aggregate count alone.
          console.log('[deezer-sync] no match for', artist.name, `(${result.reason})`);
        } else {
          errorCount++;
          lastError = result.error;
          logSyncFailure(run.id, 'deezer', artist.id, artist.name, result.error ?? result.reason);
          console.error('[deezer-sync] lookup failed for', artist.name, result.reason, result.error);
        }
        continue;
      }
      stampSourceSyncedAt(artist.id, 'deezer');
      updateArtist(artist.id, result.data as ArtistInput);
      updatedCount++;
    }

    const failedCount = noMatchCount + errorCount;
    completeSyncRun(run.id, { status: 'completed', checkedCount: artists.length, updatedCount, failedCount, noMatchCount, errorCount, lastError });
    return NextResponse.json({ runId: run.id, checked: artists.length, updated: updatedCount, noMatch: noMatchCount, errors: errorCount, lastError });
  } catch (err: any) {
    const message = err?.message ?? 'Unknown error during Deezer sync.';
    const failedCount = noMatchCount + errorCount;
    completeSyncRun(run.id, { status: 'failed', checkedCount: artists.length, updatedCount, failedCount, error: message, noMatchCount, errorCount, lastError });
    return NextResponse.json({ error: message, runId: run.id }, { status: 500 });
  }
}
