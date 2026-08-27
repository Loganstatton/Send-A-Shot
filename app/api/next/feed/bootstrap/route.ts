import { NextResponse } from 'next/server';
import { completeSyncRun, createSyncRun } from '@/lib/db';
import { getInternalUser } from '@/lib/auth';
import { notifyAdminsOfRunFailure } from '@/lib/ops-alerts';
import { bootstrapFeedFromHistory } from '@/lib/feed-bootstrap';

export const dynamic = 'force-dynamic';

// Same dual-auth pattern as every other scheduled/one-time Feed endpoint —
// a logged-in internal session, or the shared CRON_SECRET. Safe to call
// any number of times: bootstrapFeedFromHistory reuses the live code's own
// dedupe_key scheme, so a repeat call (or a call after some of these
// events already exist because the live code created them first) creates
// zero duplicates. Left as a permanent step in discovery-scan.yml rather
// than a manual one-off, since a no-op run costs almost nothing.
async function isAuthorized(req: Request): Promise<boolean> {
  const user = await getInternalUser();
  if (user) return true;
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get('x-cron-secret') === secret;
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const run = createSyncRun('feed_bootstrap');
  try {
    const result = bootstrapFeedFromHistory();
    const created = result.newArtist + result.earlyDiscovery + result.artistUpdate;
    completeSyncRun(run.id, { status: 'completed', checkedCount: created, updatedCount: created, failedCount: 0 });
    return NextResponse.json({ runId: run.id, ...result });
  } catch (err: any) {
    const message = err?.message ?? 'Unknown error bootstrapping the Feed.';
    completeSyncRun(run.id, { status: 'failed', checkedCount: 0, updatedCount: 0, failedCount: 0, error: message });
    await notifyAdminsOfRunFailure('NEXT Feed bootstrap', message);
    return NextResponse.json({ error: message, runId: run.id }, { status: 500 });
  }
}
