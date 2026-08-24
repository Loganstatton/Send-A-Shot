import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth';
import {
  getDiscoveryCandidateCountsByGenre, getDiscoveryCandidateCountsByStatus, getRecentDiscoveryReviewDecisions,
  getRecentDiscoveryRunsWithCandidateCounts, YOUTUBE_GENRE_LABELS,
} from '@/lib/db';
import AdminTabs from '@/components/AdminTabs';
import { DiscoveryRun, DiscoverySourceKey } from '@/lib/types';

export const metadata: Metadata = { title: { absolute: 'Discovery — Scout' } };
export const dynamic = 'force-dynamic';

const REJECTION_LABELS: { key: keyof DiscoveryRun; label: string }[] = [
  { key: 'rejected_not_official_release', label: 'not an official release' },
  { key: 'rejected_below_min_views', label: 'below min views' },
  { key: 'rejected_no_subscriber_count', label: 'no subscriber count' },
  { key: 'rejected_subscriber_out_of_band', label: 'subscriber count out of band' },
  { key: 'rejected_below_momentum_threshold', label: 'below momentum threshold' },
  { key: 'rejected_duplicate_soundcharts_match', label: 'duplicate (already-known artist)' },
];

function RunHistory({ source, runs }: { source: DiscoverySourceKey; runs: (DiscoveryRun & { candidateCount: number })[] }) {
  if (runs.length === 0) {
    return (
      <div>
        <h3 className="font-semibold capitalize">{source}</h3>
        <p className="text-sm" style={{ color: 'var(--text-faint)' }}>Never run.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <h3 className="font-semibold capitalize">{source}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[520px]" style={{ borderCollapse: 'collapse' }}>
          <thead className="text-left">
            <tr>
              <th className="font-normal pb-2" style={{ color: 'var(--text-faint)' }}>Started</th>
              <th className="font-normal pb-2" style={{ color: 'var(--text-faint)' }}>Status</th>
              <th className="font-normal pb-2 text-right" style={{ color: 'var(--text-faint)' }}>Searched</th>
              <th className="font-normal pb-2 text-right" style={{ color: 'var(--text-faint)' }}>Candidates</th>
              <th className="font-normal pb-2 text-right" style={{ color: 'var(--text-faint)' }}>Rejected (why)</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const rejections = REJECTION_LABELS
                .map(({ key, label }) => ({ label, count: run[key] as number | undefined }))
                .filter((r) => (r.count ?? 0) > 0);
              return (
                <tr key={run.id} style={{ borderTop: '1px solid var(--border-soft)' }}>
                  <td className="py-2 pr-3 num" style={{ color: 'var(--text-faint)' }}>{new Date(run.started_at).toLocaleString()}</td>
                  <td className="py-2 pr-3">
                    {run.status === 'failed' ? <span style={{ color: 'var(--down)' }}>failed{run.error ? `: ${run.error}` : ''}</span> : run.status}
                  </td>
                  <td className="num py-2 pr-3 text-right">{run.searched_count}</td>
                  <td className="num py-2 pr-3 text-right">{run.candidateCount}</td>
                  <td className="py-2 text-right text-xs" style={{ color: 'var(--text-faint)' }}>
                    {rejections.length === 0 ? '—' : rejections.map((r) => `${r.count} ${r.label}`).join(', ')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function AdminDiscoveryPage() {
  await requireAdmin();

  const youtubeRuns = getRecentDiscoveryRunsWithCandidateCounts('youtube', 10);
  const soundchartsRuns = getRecentDiscoveryRunsWithCandidateCounts('soundcharts', 10);
  const statusCounts = getDiscoveryCandidateCountsByStatus();
  const genreCounts = getDiscoveryCandidateCountsByGenre();
  const decisions = getRecentDiscoveryReviewDecisions(30);

  return (
    <div className="space-y-6">
      <AdminTabs />
      <div>
        <h1 className="text-2xl font-bold">Discovery</h1>
        <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
          Scan history, genre coverage, and review activity for the Candidate Queue — the dashboard&apos;s and
          Discovery page&apos;s own widgets only ever show the single most recent run.
        </p>
      </div>

      <div className="card space-y-4">
        <h2 className="font-bold text-lg">Recent scans</h2>
        <RunHistory source="youtube" runs={youtubeRuns} />
        <RunHistory source="soundcharts" runs={soundchartsRuns} />
      </div>

      <div className="card space-y-3">
        <h2 className="font-bold text-lg">Candidate Queue</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="num text-xl font-semibold">{statusCounts.new}</p>
            <p style={{ color: 'var(--text-faint)' }}>new</p>
          </div>
          <div>
            <p className="num text-xl font-semibold">{statusCounts.watching}</p>
            <p style={{ color: 'var(--text-faint)' }}>watching</p>
          </div>
          <div>
            <p className="num text-xl font-semibold">{statusCounts.approved}</p>
            <p style={{ color: 'var(--text-faint)' }}>approved</p>
          </div>
          <div>
            <p className="num text-xl font-semibold">{statusCounts.passed}</p>
            <p style={{ color: 'var(--text-faint)' }}>passed</p>
          </div>
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="font-bold text-lg">Genre coverage (YouTube)</h2>
        {genreCounts.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No YouTube candidates found yet.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            {genreCounts.map((g) => (
              <div key={g.genre} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ border: '1px solid var(--border-soft)' }}>
                <span>{YOUTUBE_GENRE_LABELS[g.genre] ?? g.genre}</span>
                <span className="num font-semibold">{g.count}</span>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
          A genre missing from this list, or stuck near 0 across several scans, is worth checking against
          YOUTUBE_SCAN_GENRES — it may need a broader search query or isn&apos;t worth scanning right now.
        </p>
      </div>

      <div className="card space-y-3">
        <h2 className="font-bold text-lg">Recent review decisions</h2>
        {decisions.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No candidates reviewed yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[480px]" style={{ borderCollapse: 'collapse' }}>
              <thead className="text-left">
                <tr>
                  <th className="font-normal pb-2" style={{ color: 'var(--text-faint)' }}>When</th>
                  <th className="font-normal pb-2" style={{ color: 'var(--text-faint)' }}>Candidate</th>
                  <th className="font-normal pb-2" style={{ color: 'var(--text-faint)' }}>Decision</th>
                  <th className="font-normal pb-2" style={{ color: 'var(--text-faint)' }}>By</th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((d) => (
                  <tr key={d.id} style={{ borderTop: '1px solid var(--border-soft)' }}>
                    <td className="py-2 pr-3 num" style={{ color: 'var(--text-faint)' }}>{new Date(d.created_at).toLocaleString()}</td>
                    <td className="py-2 pr-3">{d.candidate_name} <span style={{ color: 'var(--text-faint)' }}>({d.candidate_source})</span></td>
                    <td className="py-2 pr-3">{d.from_status} → {d.to_status}</td>
                    <td className="py-2" style={{ color: 'var(--text-faint)' }}>{d.actor_name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
