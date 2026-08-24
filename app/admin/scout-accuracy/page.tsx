import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { getScoutAccuracyRows, getScoutAccuracySummary, interpretCorrelation, MIN_DAYS_FOR_ACCURACY_ROW } from '@/lib/scout-accuracy';
import AdminTabs from '@/components/AdminTabs';

export const metadata: Metadata = { title: { absolute: 'Scout accuracy — Scout' } };
export const dynamic = 'force-dynamic';

export default async function AdminScoutAccuracyPage() {
  await requireAdmin();

  const rows = getScoutAccuracyRows();
  const summary = getScoutAccuracySummary(rows);

  return (
    <div className="space-y-6">
      <AdminTabs />
      <div>
        <h1 className="text-2xl font-bold">Was Scout right?</h1>
        <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
          Compares each artist&apos;s Scout-rated score at first review against their real audience growth
          measured at least {MIN_DAYS_FOR_ACCURACY_ROW} days later — did the early human judgment (talent,
          brand, commercial potential, etc.) actually predict who kept growing? Computed fresh from
          score_history every time this page loads, not a periodic job.
        </p>
      </div>

      <div className="card space-y-3">
        <h2 className="font-bold text-lg">Summary</h2>
        {summary.sampleSize === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Not enough artists have both an early rating and a later growth measurement {MIN_DAYS_FOR_ACCURACY_ROW}+
            days apart yet.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="num text-xl font-semibold">{summary.sampleSize}</p>
                <p style={{ color: 'var(--text-faint)' }}>artists compared</p>
              </div>
              <div>
                <p className="num text-xl font-semibold">{summary.correlation ?? '—'}</p>
                <p style={{ color: 'var(--text-faint)' }}>correlation (r)</p>
              </div>
              <div>
                <p className="num text-xl font-semibold">{summary.topQuartileAvgGrowth != null ? `${summary.topQuartileAvgGrowth}%` : '—'}</p>
                <p style={{ color: 'var(--text-faint)' }}>avg growth, top-rated quartile</p>
              </div>
              <div>
                <p className="num text-xl font-semibold">{summary.bottomQuartileAvgGrowth != null ? `${summary.bottomQuartileAvgGrowth}%` : '—'}</p>
                <p style={{ color: 'var(--text-faint)' }}>avg growth, bottom-rated quartile</p>
              </div>
            </div>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {interpretCorrelation(summary.correlation)}
              {summary.topQuartileAvgGrowth != null && summary.bottomQuartileAvgGrowth != null && (
                summary.topQuartileAvgGrowth > summary.bottomQuartileAvgGrowth
                  ? ' — artists Scout rated highest early on did grow faster on average, which is the intended signal.'
                  : ' — artists Scout rated highest early on did NOT grow faster on average; worth a closer look at what the ratings are actually capturing.'
              )}
            </p>
          </>
        )}
      </div>

      <div className="card space-y-3">
        <h2 className="font-bold text-lg">By artist</h2>
        {rows.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No artists have enough history yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]" style={{ borderCollapse: 'collapse' }}>
              <thead className="text-left">
                <tr>
                  <th className="font-normal pb-2" style={{ color: 'var(--text-faint)' }}>Artist</th>
                  <th className="font-normal pb-2" style={{ color: 'var(--text-faint)' }}>Stage</th>
                  <th className="font-normal pb-2 text-right" style={{ color: 'var(--text-faint)' }}>First rated</th>
                  <th className="font-normal pb-2 text-right" style={{ color: 'var(--text-faint)' }}>Scout rating</th>
                  <th className="font-normal pb-2 text-right" style={{ color: 'var(--text-faint)' }}>Growth then</th>
                  <th className="font-normal pb-2 text-right" style={{ color: 'var(--text-faint)' }}>Growth now</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.artistId} style={{ borderTop: '1px solid var(--border-soft)' }}>
                    <td className="py-2 pr-3"><Link className="underline font-medium" href={`/artists/${r.artistId}`}>{r.artistName}</Link></td>
                    <td className="py-2 pr-3 capitalize" style={{ color: 'var(--text-muted)' }}>{r.stage}</td>
                    <td className="num py-2 pr-3 text-right" style={{ color: 'var(--text-faint)' }}>{r.daysSinceFirstRating}d ago</td>
                    <td className="num py-2 pr-3 text-right font-semibold">{r.initialScoutRatingAvg}/10</td>
                    <td className="num py-2 pr-3 text-right" style={{ color: 'var(--text-faint)' }}>{r.initialGrowthPct != null ? `${r.initialGrowthPct}%` : '—'}</td>
                    <td className="num py-2 text-right" style={{ color: r.latestGrowthPct != null ? 'var(--up)' : 'var(--text-faint)' }}>
                      {r.latestGrowthPct != null ? `${r.latestGrowthPct}%` : '—'}
                    </td>
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
