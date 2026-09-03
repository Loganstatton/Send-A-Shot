import { NextResponse } from 'next/server';
import { getInternalUser } from '@/lib/auth';
import {
  completeSyncRun, createSyncRun, getArtistsInPhotoBackoff, getArtistsMissingPhoto, logSyncFailure,
  stampSoundchartsNoMatch, stampSourceSyncedAt, updateArtist,
} from '@/lib/db';
import { notifyAdminsOfRunFailure } from '@/lib/ops-alerts';
import { getArtistData, searchArtists, soundchartsConfigured } from '@/lib/soundcharts';
import { withRetry } from '@/lib/retry';
import { ArtistInput } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Same dual-auth pattern as /api/youtube/sync-videos: a logged-in internal
// session (a manual "Backfill missing photos" button), or the shared
// CRON_SECRET for an external scheduler.
async function isAuthorized(req: Request): Promise<boolean> {
  const user = await getInternalUser();
  if (user) return true;
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get('x-cron-secret') === secret;
}

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!soundchartsConfigured()) {
    return NextResponse.json({ error: 'Soundcharts is not configured on this server.' }, { status: 503 });
  }

  const run = createSyncRun('soundcharts_photo');
  // Every artist still missing a photo and never linked to Soundcharts, and
  // not in the "recently confirmed no match" backoff window — this is what
  // backfills artists /api/soundcharts/sync can never reach (it only
  // re-syncs artists already linked by uuid), including anyone who fell
  // through the on-create lookup in app/api/artists/route.ts or a rate
  // limit during a large batch (see components/BulkAddArtists.tsx).
  const artists = getArtistsMissingPhoto();
  let checkedCount = 0;
  let updatedCount = 0;
  let noMatchCount = 0;
  let errorCount = 0;
  let lastError: string | undefined;

  try {
    for (const artist of artists) {
      // One automatic retry, same as /api/soundcharts/sync — Soundcharts
      // calls have no meaningful per-call quota cost, unlike YouTube, so a
      // retry here is safe. Paced 300ms apart (the fix from the bulk-add
      // rate-limit incident this route exists to clean up after) so this
      // backfill doesn't trip the same rate limit itself.
      const searchResult = await withRetry(() => searchArtists(artist.name));
      if (!searchResult.ok) {
        checkedCount++;
        errorCount++;
        lastError = searchResult.error;
        logSyncFailure(run.id, 'soundcharts_photo', artist.id, artist.name, searchResult.error);
        await pause(300);
        continue;
      }

      const normalized = artist.name.trim().toLowerCase();
      const best = searchResult.data.find((h) => h.name.trim().toLowerCase() === normalized) ?? searchResult.data[0];
      if (!best) {
        checkedCount++;
        noMatchCount++;
        stampSoundchartsNoMatch(artist.id);
        await pause(300);
        continue;
      }

      const dataResult = await withRetry(() => getArtistData(best.uuid));
      checkedCount++;
      if (!dataResult.ok) {
        errorCount++;
        lastError = dataResult.error;
        logSyncFailure(run.id, 'soundcharts_photo', artist.id, artist.name, dataResult.error);
        await pause(300);
        continue;
      }

      stampSourceSyncedAt(artist.id, 'soundcharts');
      const nonEmpty = Object.fromEntries(Object.entries(dataResult.data).filter(([, v]) => v != null && v !== ''));
      if (nonEmpty.photo_url) {
        // Links the artist for the first time — see lib/db.ts's unique
        // index on soundcharts_uuid — so future /api/soundcharts/sync runs
        // pick them up automatically from here on, same as anyone who got
        // linked at creation time.
        //
        // Pre-beta migration: tagged LEGACY_SOUNDCHARTS so the public image
        // resolver (lib/artist-image.ts) never surfaces it — Soundcharts
        // photos have no established public reuse rights, same reasoning as
        // Deezer's (see app/api/deezer/sync/route.ts). Still written and
        // still visible to a Scout in ArtistForm/the internal roster — this
        // route's photo fill is now an internal-only convenience, not a
        // public-facing one.
        updateArtist(artist.id, { ...nonEmpty, soundcharts_uuid: best.uuid, photo_source_type: 'LEGACY_SOUNDCHARTS' } as ArtistInput);
        updatedCount++;
      } else {
        // Matched a Soundcharts profile, but it doesn't carry a photo on
        // this plan (see lib/soundcharts.ts's header comment) — a genuine,
        // stable outcome, not worth re-checking on a timer.
        noMatchCount++;
        stampSoundchartsNoMatch(artist.id);
      }
      await pause(300);
    }

    const failedCount = noMatchCount + errorCount;
    completeSyncRun(run.id, { status: 'completed', checkedCount, updatedCount, failedCount, noMatchCount, errorCount, lastError });
    const inBackoff = getArtistsInPhotoBackoff().count;
    return NextResponse.json({ runId: run.id, checked: checkedCount, updated: updatedCount, noMatch: noMatchCount, errors: errorCount, lastError, inBackoff });
  } catch (err: any) {
    const message = err?.message ?? 'Unknown error during Soundcharts photo backfill.';
    const failedCount = noMatchCount + errorCount;
    completeSyncRun(run.id, { status: 'failed', checkedCount, updatedCount, failedCount, error: message, noMatchCount, errorCount, lastError });
    await notifyAdminsOfRunFailure('Soundcharts photo backfill', message);
    return NextResponse.json({ error: message, runId: run.id }, { status: 500 });
  }
}
