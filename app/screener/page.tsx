import Link from 'next/link';
import { getPortfolioSummary } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { formatCents } from '@/lib/format';
import { momentumStatus } from '@/lib/scoring';
import { STAGE_LABELS } from '@/lib/types';
import Sparkline from '@/components/Sparkline';

export const dynamic = 'force-dynamic';

export default async function ScreenerPage() {
  await requireUser();
  const rows = getPortfolioSummary()
    .filter((r) => r.artist.stage !== 'passed')
    .sort((a, b) => b.score - a.score);

  const totals = rows.reduce(
    (acc, r) => ({
      invested: acc.invested + r.totalInvestedCents,
      commission: acc.commission + r.totalCommissionCents,
    }),
    { invested: 0, commission: 0 }
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Screener</h1>
          <p className="text-neutral-400 text-sm">Every tracked artist, ticker-style — score momentum, investment, and return in one screen.</p>
        </div>
        <div className="flex gap-3 flex-wrap">
          <div className="badge">Artists: {rows.length}</div>
          <div className="badge">Invested: {formatCents(totals.invested)}</div>
          <div className="badge">Commission earned: {formatCents(totals.commission)}</div>
        </div>
      </div>

      {rows.length === 0 && (
        <div className="card text-center py-12">
          <p className="text-neutral-400">No artists tracked yet.</p>
          <Link href="/artists/new" className="btn btn-primary mt-4 inline-flex">+ Add your first artist</Link>
        </div>
      )}

      {rows.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead className="text-neutral-500 text-left">
              <tr>
                <th className="font-normal pb-2">Artist</th>
                <th className="font-normal pb-2">Stage</th>
                <th className="font-normal pb-2">Trend</th>
                <th className="font-normal pb-2 text-right">Score</th>
                <th className="font-normal pb-2 text-right">Change</th>
                <th className="font-normal pb-2 text-right">Invested</th>
                <th className="font-normal pb-2 text-right">Commission</th>
                <th className="font-normal pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const status = momentumStatus(row.changeAbs, row.hasComparison);
                const changeColor = row.changeAbs > 0
                  ? 'text-emerald-400'
                  : row.changeAbs < 0
                    ? 'text-red-400'
                    : 'text-neutral-400';
                return (
                  <tr key={row.artist.id} className="border-t border-neutral-800">
                    <td className="py-2 pr-3">
                      <Link href={`/artists/${row.artist.id}`} className="font-semibold hover:underline">
                        {row.artist.name}
                      </Link>
                      {row.artist.genre && <div className="text-xs text-neutral-500">{row.artist.genre}</div>}
                    </td>
                    <td className="py-2 pr-3 text-neutral-400 whitespace-nowrap">{STAGE_LABELS[row.artist.stage]}</td>
                    <td className="py-2 pr-3">
                      {row.scoreHistory.length > 1 ? (
                        <Sparkline points={row.scoreHistory.map((h) => h.breakout_score)} className="w-24 h-8" />
                      ) : (
                        <span className="text-xs text-neutral-600">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right font-semibold">{row.score.toFixed(1)}</td>
                    <td className={`py-2 pr-3 text-right font-medium whitespace-nowrap ${changeColor}`}>
                      {row.hasComparison ? (
                        <>
                          {row.changeAbs > 0 ? '+' : ''}{row.changeAbs.toFixed(1)}
                          {row.changePct != null && (
                            <span className="text-xs opacity-70"> ({row.changePct > 0 ? '+' : ''}{row.changePct.toFixed(1)}%)</span>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">{formatCents(row.totalInvestedCents)}</td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">{formatCents(row.totalCommissionCents)}</td>
                    <td className="py-2 whitespace-nowrap">{status.emoji} {status.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
