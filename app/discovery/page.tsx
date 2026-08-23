import type { Metadata } from 'next';
import { getDiscoveryCandidates, getLatestDiscoveryRun } from '@/lib/db';
import { requireInternal } from '@/lib/auth';
import { DiscoveryRun } from '@/lib/types';
import DiscoveryQueue from '@/components/DiscoveryQueue';
import YoutubeScanButton from '@/components/YoutubeScanButton';

export const metadata: Metadata = { title: { absolute: 'New Candidates — Scout' } };
export const dynamic = 'force-dynamic';

function rejectionSummary(run: DiscoveryRun): string | null {
  if (run.candidates_found > 0) return null;
  const parts = [
    run.rejected_not_official_release && `${run.rejected_not_official_release} not tagged as an official release`,
    run.rejected_below_min_views && `${run.rejected_below_min_views} too few views`,
    run.rejected_no_subscriber_count && `${run.rejected_no_subscriber_count} no subscriber count`,
    run.rejected_subscriber_out_of_band && `${run.rejected_subscriber_out_of_band} channel size outside band`,
    run.rejected_below_momentum_threshold &&
      `${run.rejected_below_momentum_threshold} below momentum threshold${run.best_rejected_momentum_score != null ? ` (best: ${run.best_rejected_momentum_score}/100)` : ''}`,
  ].filter(Boolean);
  return parts.length > 0 ? `Rejected: ${parts.join(', ')}.` : null;
}

function LastRunLine({ label, run }: { label: string; run?: DiscoveryRun }) {
  if (!run) return null;
  const rejected = run.status === 'completed' ? rejectionSummary(run) : null;
  return (
    <p className="num text-xs" style={{ color: 'var(--text-faint)' }}>
      {label}: {new Date(run.started_at).toLocaleString()} —{' '}
      {run.status === 'failed'
        ? <span style={{ color: 'var(--down)' }}>failed: {run.error}</span>
        : `searched ${run.searched_count}, found ${run.candidates_found}.`}
      {rejected && <span> {rejected}</span>}
    </p>
  );
}

export default async function DiscoveryPage() {
  await requireInternal();
  const candidates = getDiscoveryCandidates('new');
  const watching = getDiscoveryCandidates('watching');
  const lastYoutubeRun = getLatestDiscoveryRun('youtube');

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">New Candidates</h1>
          <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
            Artists YouTube flagged for unusual momentum — nobody searched for these by name.
            Approve to add them to Scout&apos;s roster and rate them; Watch to keep an eye without committing; Pass to drop them for good.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <YoutubeScanButton />
        </div>
      </div>

      <div className="space-y-1">
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
