import { NextResponse } from 'next/server';
import { getInternalUser } from '@/lib/auth';
import { completeSyncRun, createSyncRun, getArtistsWithSoundchartsLink, logSyncFailure, stampSourceSyncedAt, updateArtist } from '@/lib/db';
import { notifyAdminsOfRunFailure } from '@/lib/ops-alerts';
import { getArtistData, soundchartsConfigured } from '@/lib/soundcharts';
import { withRetry } from '@/lib/retry';
import { ArtistInput } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Same dual-auth pattern as /api/discovery/scan: a logged-in internal
// session (a manual "Sync all now"), or a shared secret for an external
// scheduler. This is what lets growth_velocity_pct/followers_count/etc.
// across the whole roster stay current WITHOUT anyone clicking the
// per-artist "Sync from Soundcharts" button on every artist, every day —
// see README for wiring up a daily scheduler.
async function isAuthorized(req: Request): Promise<boolean> {
  const user = await getInternalUser();
  if (user) return true;
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get('x-cron-secret') === secret;
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (!soundchartsConfigured()) {
    return NextResponse.json({ error: 'Soundcharts is not configured on this server.' }, { status: 503 });
  }

  const run = createSyncRun();
  const linked = getArtistsWithSoundchartsLink();
  let updatedCount = 0;
  let failedCount = 0;

  try {
    for (const { id, name, soundcharts_uuid } of linked) {
      // One automatic retry before counting this artist as failed — see
      // lib/retry.ts for why this is safe for Soundcharts (no meaningful
      // per-call quota cost) but not done for YouTube.
      const result = await withRetry(() => getArtistData(soundcharts_uuid));
      if (!result.ok) {
        failedCount++;
        logSyncFailure(run.id, 'soundcharts', id, name, result.error);
        continue;
      }
      stampSourceSyncedAt(id, 'soundcharts');
      // Same rule the manual "Sync from Soundcharts" button follows: only
      // fields Soundcharts actually returned a value for get written, so a
      // transient gap in their response never blanks out something a Scout
      // typed in by hand. Unlike the manual button, `name` is deliberately
      // excluded here — a background job silently renaming an artist with
      // no human reviewing the change first is the wrong default; a Scout
      // can still pull the new name in via the manual button if it matters.
      const { name: _name, ...rest } = result.data;
      const nonEmpty: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([, v]) => v != null && v !== ''));
      // Pre-beta migration: tag a re-synced photo LEGACY_SOUNDCHARTS same as
      // the backfill route (app/api/soundcharts/backfill/route.ts) — never
      // surfaced by the public image resolver, see lib/artist-image.ts.
      if (nonEmpty.photo_url) nonEmpty.photo_source_type = 'LEGACY_SOUNDCHARTS';
      if (Object.keys(nonEmpty).length > 0) {
        // updateArtist only writes fields present in the object (see
        // lib/db.ts) — ArtistInput's required `name` is a create-time
        // constraint that doesn't apply to a partial update like this one.
        updateArtist(id, nonEmpty as ArtistInput);
        updatedCount++;
      }
    }

    completeSyncRun(run.id, { status: 'completed', checkedCount: linked.length, updatedCount, failedCount });
    return NextResponse.json({ runId: run.id, checked: linked.length, updated: updatedCount, failed: failedCount });
  } catch (err: any) {
    const message = err?.message ?? 'Unknown error during sync.';
    completeSyncRun(run.id, { status: 'failed', checkedCount: linked.length, updatedCount, failedCount, error: message });
    await notifyAdminsOfRunFailure('Soundcharts sync', message);
    return NextResponse.json({ error: message, runId: run.id }, { status: 500 });
  }
}
