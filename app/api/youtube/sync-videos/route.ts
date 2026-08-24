import { NextResponse } from 'next/server';
import { getInternalUser } from '@/lib/auth';
import {
  completeSyncRun, createSyncRun, getArtistsInVideoBackoff, getArtistsMissingVideo, logSyncFailure,
  setFeaturedVideoMatchType, stampSourceSyncedAt, stampYoutubeNoMatch, updateArtist,
} from '@/lib/db';
import { getFeaturedVideoForArtist, youtubeConfigured } from '@/lib/youtube';
import { ArtistInput } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Same dual-auth pattern as /api/deezer/sync: a logged-in internal session
// (a manual "Backfill YouTube videos" button), or the shared CRON_SECRET
// for an external scheduler.
async function isAuthorized(req: Request): Promise<boolean> {
  const user = await getInternalUser();
  if (user) return true;
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get('x-cron-secret') === secret;
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!youtubeConfigured()) return NextResponse.json({ error: 'YouTube is not configured on this server.' }, { status: 400 });

  const run = createSyncRun('youtube_video');
  // Every artist still missing a featured video and not in the "recently
  // confirmed no match" backoff window — this is what backfills existing
  // manually-added artists (they never got the on-create lookup in
  // app/api/artists/route.ts), not just new ones going forward.
  const artists = getArtistsMissingVideo();
  let attemptedCount = 0;
  let updatedCount = 0;
  let noMatchCount = 0;
  let errorCount = 0;
  let lastError: string | undefined;
  let queuedForQuotaReset = 0;

  try {
    for (const artist of artists) {
      // No automatic retry here (unlike Soundcharts/Deezer) — a retry would
      // double the quota cost of every failure, which fights against the
      // "YouTube quota protection" section of this same phase.
      const result = await getFeaturedVideoForArtist(artist.name, artist.youtube_url);
      if (!result.ok) {
        if (result.quotaExceeded) {
          // Stop spending time (and, if it's OUR OWN pre-flight check that
          // tripped, this is the only cost) hammering an API that's going
          // to keep refusing every remaining artist. They're left exactly
          // as "missing a video" — getArtistsMissingVideo will pick them
          // right back up on the next scheduled run once quota resets,
          // with no separate queue table needed.
          queuedForQuotaReset = artists.length - attemptedCount;
          console.log('[youtube-video-sync] quota exhausted —', queuedForQuotaReset, 'artist(s) left for the next run');
          break;
        }
        attemptedCount++;
        errorCount++;
        lastError = result.error;
        logSyncFailure(run.id, 'youtube_video', artist.id, artist.name, result.error);
        console.error('[youtube-video-sync] lookup failed for', artist.name, result.error);
        continue;
      }
      attemptedCount++;
      // A completed, honest check either way — including "found nothing
      // usable" (no hits, or the only candidate failed the embeddability
      // check inside getFeaturedVideoForArtist).
      stampSourceSyncedAt(artist.id, 'youtube');
      if (!result.data) {
        noMatchCount++;
        stampYoutubeNoMatch(artist.id);
        console.log('[youtube-video-sync] no match for', artist.name);
        continue;
      }
      setFeaturedVideoMatchType(artist.id, result.data.matchType);
      updateArtist(artist.id, { featured_video_id: result.data.videoId } as ArtistInput);
      updatedCount++;
    }

    const failedCount = noMatchCount + errorCount;
    completeSyncRun(run.id, { status: 'completed', checkedCount: attemptedCount, updatedCount, failedCount, noMatchCount, errorCount, lastError });
    // So a caller can explain a "checked 0" result instead of leaving it
    // looking broken — was there really nothing to check, or is everything
    // sitting in the recheck backoff? (queuedForQuotaReset already covers
    // the third case, quota exhaustion mid-run.)
    const inBackoff = getArtistsInVideoBackoff().count;
    return NextResponse.json({
      runId: run.id, checked: attemptedCount, updated: updatedCount, noMatch: noMatchCount, errors: errorCount, lastError,
      queuedForQuotaReset, inBackoff,
    });
  } catch (err: any) {
    const message = err?.message ?? 'Unknown error during YouTube video sync.';
    const failedCount = noMatchCount + errorCount;
    completeSyncRun(run.id, { status: 'failed', checkedCount: attemptedCount, updatedCount, failedCount, error: message, noMatchCount, errorCount, lastError });
    return NextResponse.json({ error: message, runId: run.id }, { status: 500 });
  }
}
