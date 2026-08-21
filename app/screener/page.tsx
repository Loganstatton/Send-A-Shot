import Link from 'next/link';
import { getPortfolioSummary } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { formatCents } from '@/lib/format';
import { momentumStatus } from '@/lib/scoring';
import { STAGE_LABELS } from '@/lib/types';
import Sparkline from '@/components/Sparkline';
import StatTile from '@/components/StatTile';

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
      gross: acc.gross + r.totalGrossCents,
    }),
    { invested: 0, commission: 0, gross: 0 }
  );

  // rows is already sorted by score desc, so the top performer is rows[0].
  const topPerformer = rows.length > 0 ? rows[0] : null;
  const fastestGrowing = rows
    .filter((r) => r.hasComparison)
    .reduce<(typeof rows)[number] | null>((best, r) => (!best || r.changeAbs > best.changeAbs ? r : best), null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Screener</h1>
        <p className="text-neutral-400 text-sm">Every tracked artist, ticker-style — score momentum, investment, and return in one screen.</p>
      </div>

      {rows.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatTile label="Artists tracked" value={String(rows.length)} />
          <StatTile label="Total invested" value={formatCents(totals.invested)} />
          <StatTile label="Total revenue" value={formatCents(totals.gross)} />
          <StatTile label="Commission earned" value={formatCents(totals.commission)} />
          <StatTile
            label="Top performer"
            value={topPerformer?.artist.name ?? '—'}
            delta={topPerformer ? topPerformer.score.toFixed(1) : undefined}
          />
          <StatTile
            label="Fastest growing"
            value={fastestGrowing?.artist.name ?? '—'}
            delta={fastestGrowing ? `${fastestGrowing.changeAbs > 0 ? '+' : ''}${fastestGrowing.changeAbs.toFixed(1)}` : undefined}
            deltaTone={fastestGrowing ? (fastestGrowing.changeAbs >= 0 ? 'up' : 'down') : 'neutral'}
          />
        </div>
      )}

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
                <th className="font-normal pb-2 text-right">ROI</th>
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
                    <td className={`py-2 pr-3 text-right whitespace-nowrap font-medium ${
                      row.roiPct == null ? 'text-neutral-600' : row.roiPct >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}>
                      {row.roiPct != null ? `${row.roiPct > 0 ? '+' : ''}${row.roiPct}%` : '—'}
                    </td>
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
