import type { Metadata } from 'next';
import { getDiscoveryCandidates, getLatestDiscoveryRun } from '@/lib/db';
import { requireInternal } from '@/lib/auth';
import DiscoveryQueue from '@/components/DiscoveryQueue';
import DiscoveryScanButton from '@/components/DiscoveryScanButton';

export const metadata: Metadata = { title: { absolute: 'New Candidates — Scout' } };
export const dynamic = 'force-dynamic';

export default async function DiscoveryPage() {
  await requireInternal();
  const candidates = getDiscoveryCandidates('new');
  const watching = getDiscoveryCandidates('watching');
  const lastRun = getLatestDiscoveryRun();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">New Candidates</h1>
          <p className="text-neutral-400 text-sm">
            Artists Soundcharts flagged for unusual growth — nobody searched for these by name.
            Approve to add them to Scout&apos;s roster and rate them; Watch to keep an eye without committing; Pass to drop them for good.
          </p>
        </div>
        <DiscoveryScanButton />
      </div>

      {lastRun && (
        <p className="text-xs text-neutral-500">
          Last scan: {new Date(lastRun.started_at).toLocaleString()} —{' '}
          {lastRun.status === 'failed'
            ? <span className="text-red-400">failed: {lastRun.error}</span>
            : `searched ${lastRun.searched_count}, found ${lastRun.candidates_found}`}
        </p>
      )}

      <DiscoveryQueue initial={candidates} />

      {watching.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer text-neutral-400 text-sm">Watching ({watching.length})</summary>
          <div className="mt-3">
            <DiscoveryQueue initial={watching} />
          </div>
        </details>
      )}
    </div>
  );
}
