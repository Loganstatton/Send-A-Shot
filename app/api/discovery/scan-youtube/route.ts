import { NextResponse } from 'next/server';
import { getInternalUser } from '@/lib/auth';
import {
  completeDiscoveryRun, createDiscoveryRun, getKnownDiscoveryUuids, getKnownDiscoveryYoutubeChannelIds,
  getTrackedSoundchartsUuids, insertDiscoveryCandidate,
} from '@/lib/db';
import { youtubeDiscoverySource } from '@/lib/youtube-discovery';
import { youtubeConfigured } from '@/lib/youtube';

export const dynamic = 'force-dynamic';

// Same dual-auth pattern as /api/discovery/scan (the Soundcharts source): a
// logged-in internal session (the "Run YouTube scan now" button), or the
// shared CRON_SECRET for an external scheduler. A daily YouTube scan is
// enough per the roadmap — this doesn't need its own secret.
async function isAuthorized(req: Request): Promise<boolean> {
  const user = await getInternalUser();
  if (user) return true;
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get('x-cron-secret') === secret;
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (!youtubeConfigured()) {
    return NextResponse.json({ error: 'YouTube is not configured on this server (set YOUTUBE_API_KEY).' }, { status: 503 });
  }

  const run = createDiscoveryRun('youtube');

  try {
    const known = {
      soundchartsUuids: new Set([...getTrackedSoundchartsUuids(), ...getKnownDiscoveryUuids()]),
      youtubeChannelIds: getKnownDiscoveryYoutubeChannelIds(),
    };
    const { candidates, searchedCount, quotaUsed, rejectionBreakdown } = await youtubeDiscoverySource.scan(known);

    // candidatesFound must reflect what actually made it into the queue,
    // not how many the scan scored — a scan can score 25 real candidates
    // and still insert 0 of them (a constraint violation, a schema bug),
    // and reporting the pre-insert count as success hides exactly that.
    let insertedCount = 0;
    let insertFailedCount = 0;
    let lastInsertError: string | undefined;
    for (const candidate of candidates) {
      // Belt-and-suspenders: the scan already dedupes within itself and
      // against known channels, but a duplicate insert (a race with
      // another run, a bug) should skip that one candidate, not blow up
      // an otherwise-good scan — see roadmap requirement that a YouTube
      // failure never crashes the whole thing.
      try {
        insertDiscoveryCandidate({ ...candidate, discovery_run_id: run.id });
        insertedCount++;
      } catch (err: any) {
        insertFailedCount++;
        lastInsertError = err?.message;
        console.error('[youtube-discovery] failed to insert candidate', candidate.yt_channel_id, err?.message);
      }
    }

    completeDiscoveryRun(run.id, { status: 'completed', searchedCount, candidatesFound: insertedCount, quotaUsed, rejectionBreakdown });
    return NextResponse.json({
      runId: run.id, searchedCount, candidatesFound: insertedCount, quotaUsed, rejectionBreakdown,
      insertFailedCount, lastInsertError,
    });
  } catch (err: any) {
    const message = err?.message ?? 'Unknown error during YouTube scan.';
    completeDiscoveryRun(run.id, { status: 'failed', searchedCount: 0, candidatesFound: 0, error: message });
    return NextResponse.json({ error: message, runId: run.id }, { status: 500 });
  }
}
