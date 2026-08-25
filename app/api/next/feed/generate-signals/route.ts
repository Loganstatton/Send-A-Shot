import { NextResponse } from 'next/server';
import { getInternalUser } from '@/lib/auth';
import { completeSyncRun, createSyncRun } from '@/lib/db';
import { notifyAdminsOfRunFailure } from '@/lib/ops-alerts';
import { generateFeedSignals } from '@/lib/feed-signals';

export const dynamic = 'force-dynamic';

// Same dual-auth pattern as every other scheduled endpoint (Soundcharts/
// Deezer/YouTube sync) — a logged-in internal session, or the shared
// CRON_SECRET for the daily GitHub Actions workflow.
async function isAuthorized(req: Request): Promise<boolean> {
  const user = await getInternalUser();
  if (user) return true;
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get('x-cron-secret') === secret;
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const run = createSyncRun('feed_signals');
  try {
    const { checked, created } = generateFeedSignals();
    completeSyncRun(run.id, { status: 'completed', checkedCount: checked, updatedCount: created, failedCount: 0 });
    return NextResponse.json({ runId: run.id, checked, created });
  } catch (err: any) {
    const message = err?.message ?? 'Unknown error generating Feed signals.';
    completeSyncRun(run.id, { status: 'failed', checkedCount: 0, updatedCount: 0, failedCount: 0, error: message });
    await notifyAdminsOfRunFailure('NEXT Feed signal generation', message);
    return NextResponse.json({ error: message, runId: run.id }, { status: 500 });
  }
}
