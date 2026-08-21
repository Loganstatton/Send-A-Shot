import type { Metadata } from 'next';
import { getDiscoveryCandidates, getLatestDiscoveryRun } from '@/lib/db';
import { requireInternal } from '@/lib/auth';
import { DiscoveryRun } from '@/lib/types';
import DiscoveryQueue from '@/components/DiscoveryQueue';
import DiscoveryScanButton from '@/components/DiscoveryScanButton';
import YoutubeScanButton from '@/components/YoutubeScanButton';

export const metadata: Metadata = { title: { absolute: 'New Candidates — Scout' } };
export const dynamic = 'force-dynamic';

function LastRunLine({ label, run }: { label: string; run?: DiscoveryRun }) {
  if (!run) return null;
  return (
    <p className="text-xs text-neutral-500">
      {label}: {new Date(run.started_at).toLocaleString()} —{' '}
      {run.status === 'failed'
        ? <span className="text-red-400">failed: {run.error}</span>
        : `searched ${run.searched_count}, found ${run.candidates_found}`}
    </p>
  );
}

export default async function DiscoveryPage() {
  await requireInternal();
  const candidates = getDiscoveryCandidates('new');
  const watching = getDiscoveryCandidates('watching');
  const lastSoundchartsRun = getLatestDiscoveryRun('soundcharts');
  const lastYoutubeRun = getLatestDiscoveryRun('youtube');

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">New Candidates</h1>
          <p className="text-neutral-400 text-sm">
            Artists Soundcharts or YouTube flagged for unusual momentum — nobody searched for these by name.
            Approve to add them to Scout&apos;s roster and rate them; Watch to keep an eye without committing; Pass to drop them for good.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <DiscoveryScanButton />
          <YoutubeScanButton />
        </div>
      </div>

      <div className="space-y-1">
        <LastRunLine label="Last Soundcharts scan" run={lastSoundchartsRun} />
        <LastRunLine label="Last YouTube scan" run={lastYoutubeRun} />
      </div>

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
