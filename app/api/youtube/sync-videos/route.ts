import { NextResponse } from 'next/server';
import { getInternalUser } from '@/lib/auth';
import { completeSyncRun, createSyncRun, getArtistsMissingVideo, updateArtist } from '@/lib/db';
import { searchArtistVideo, youtubeConfigured } from '@/lib/youtube';
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
  // Every artist still missing a featured video — this is what backfills
  // existing manually-added artists (they never got the on-create lookup
  // in app/api/artists/route.ts), not just new ones going forward.
  const artists = getArtistsMissingVideo();
  let updatedCount = 0;
  let noMatchCount = 0;
  let errorCount = 0;
  let lastError: string | undefined;

  try {
    for (const artist of artists) {
      const result = await searchArtistVideo(artist.name);
      if (!result.ok) {
        errorCount++;
        lastError = result.error;
        console.error('[youtube-video-sync] lookup failed for', artist.name, result.error);
        continue;
      }
      if (!result.data) {
        noMatchCount++;
        console.log('[youtube-video-sync] no match for', artist.name);
        continue;
      }
      updateArtist(artist.id, { featured_video_id: result.data.videoId } as ArtistInput);
      updatedCount++;
    }

    const failedCount = noMatchCount + errorCount;
    completeSyncRun(run.id, { status: 'completed', checkedCount: artists.length, updatedCount, failedCount, noMatchCount, errorCount, lastError });
    return NextResponse.json({ runId: run.id, checked: artists.length, updated: updatedCount, noMatch: noMatchCount, errors: errorCount, lastError });
  } catch (err: any) {
    const message = err?.message ?? 'Unknown error during YouTube video sync.';
    const failedCount = noMatchCount + errorCount;
    completeSyncRun(run.id, { status: 'failed', checkedCount: artists.length, updatedCount, failedCount, error: message, noMatchCount, errorCount, lastError });
    return NextResponse.json({ error: message, runId: run.id }, { status: 500 });
  }
}
