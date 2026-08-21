import { NextResponse } from 'next/server';
import { getInternalUser } from '@/lib/auth';
import {
  completeDiscoveryRun, createDiscoveryRun, getKnownDiscoveryUuids, getTrackedSoundchartsUuids,
  insertDiscoveryCandidate,
} from '@/lib/db';
import { evaluateCandidates } from '@/lib/discovery';
import { soundchartsConfigured, topArtists } from '@/lib/soundcharts';

export const dynamic = 'force-dynamic';

// Two ways in: a logged-in internal session (the "Run scan now" button), or
// a shared secret for an external scheduler — Render has no built-in cron
// on a web service, so the actual "every day" part is a scheduler (Render
// Cron Job, GitHub Actions, cron-job.org, anything) hitting this route on a
// schedule with the header below. No secret configured means no automatic
// path exists yet, but the manual button still works either way.
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

  const run = createDiscoveryRun();

  try {
    const topResult = await topArtists();
    if (!topResult.ok) {
      completeDiscoveryRun(run.id, { status: 'failed', searchedCount: 0, candidatesFound: 0, error: topResult.error });
      return NextResponse.json({ error: topResult.error, runId: run.id }, { status: 502 });
    }

    const alreadyKnown = new Set([...getTrackedSoundchartsUuids(), ...getKnownDiscoveryUuids()]);
    const { candidates, searchedCount } = await evaluateCandidates(topResult.data, alreadyKnown);

    for (const candidate of candidates) {
      insertDiscoveryCandidate(candidate);
    }

    completeDiscoveryRun(run.id, { status: 'completed', searchedCount, candidatesFound: candidates.length });
    return NextResponse.json({ runId: run.id, searchedCount, candidatesFound: candidates.length });
  } catch (err: any) {
    const message = err?.message ?? 'Unknown error during scan.';
    completeDiscoveryRun(run.id, { status: 'failed', searchedCount: 0, candidatesFound: 0, error: message });
    return NextResponse.json({ error: message, runId: run.id }, { status: 500 });
  }
}
