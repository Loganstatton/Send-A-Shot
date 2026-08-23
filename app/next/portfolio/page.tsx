import Link from 'next/link';
import type { Metadata } from 'next';
import { getPortfolioValue, getPortfolioValueHistory, getUserHoldings, getUserTransactions } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { formatCents } from '@/lib/format';
import ArtistAvatar from '@/components/ArtistAvatar';
import NextStatTile from '@/components/next/NextStatTile';
import PriceChart from '@/components/PriceChart';
import AllocationBreakdown from '@/components/next/AllocationBreakdown';
import TransactionHistory from '@/components/next/TransactionHistory';

export const metadata: Metadata = { title: 'Portfolio' };
export const dynamic = 'force-dynamic';

export default async function NextPortfolioPage() {
  const user = await requireUser();
  const holdings = getUserHoldings(user.id);
  const transactions = getUserTransactions(user.id);
  const portfolio = getPortfolioValue(user.id);

  const holdingsWithValue = holdings.map((h) => {
    const marketValueCents = Math.round(h.shares * h.price_cents);
    const unrealizedPnlCents = marketValueCents - h.cost_basis_cents;
    const unrealizedPct = h.cost_basis_cents !== 0 ? (unrealizedPnlCents / h.cost_basis_cents) * 100 : 0;
    return { ...h, marketValueCents, unrealizedPnlCents, unrealizedPct };
  });

  const totalUnrealizedPnlCents = holdingsWithValue.reduce((sum, h) => sum + h.unrealizedPnlCents, 0);
  const totalRealizedPnlCents = transactions.reduce((sum, t) => sum + (t.realized_pnl_cents ?? 0), 0);
  const investedValueCents = holdingsWithValue.reduce((sum, h) => sum + h.cost_basis_cents, 0);

  // getPortfolioValueHistory only has a point at each past trade/price
  // event, so it can lag "right now" by however long it's been since the
  // last one — appending the live total here keeps the chart's "current"
  // value and the Daily return stat both true as of this page load, not
  // as of whenever the last event happened to land.
  const rawHistory = getPortfolioValueHistory(user.id);
  const nowPoint = { recorded_at: new Date().toISOString(), value_cents: portfolio.totalValueCents };
  const valueHistory = [...rawHistory, nowPoint];
  const chartPoints = valueHistory.map((p) => ({ recorded_at: p.recorded_at, value: p.value_cents }));

  const dayAgoCutoff = Date.now() - 24 * 60 * 60 * 1000;
  const dayAgoPoint = [...valueHistory].reverse().find((p) => new Date(p.recorded_at).getTime() <= dayAgoCutoff) ?? valueHistory[0];
  const dailyReturnCents = nowPoint.value_cents - dayAgoPoint.value_cents;
  const dailyReturnPct = dayAgoPoint.value_cents !== 0 ? Math.round((dailyReturnCents / dayAgoPoint.value_cents) * 1000) / 10 : 0;

  let bestPosition: (typeof holdingsWithValue)[number] | null = null;
  let worstPosition: (typeof holdingsWithValue)[number] | null = null;
  for (const h of holdingsWithValue) {
    if (!bestPosition || h.unrealizedPct > bestPosition.unrealizedPct) bestPosition = h;
    if (!worstPosition || h.unrealizedPct < worstPosition.unrealizedPct) worstPosition = h;
  }

  type Stat = { label: string; value: string; valueTone?: 'up' | 'down'; delta?: string; deltaTone?: 'up' | 'down' };
  const stats: Stat[] = [
    { label: 'Portfolio value', value: formatCents(portfolio.totalValueCents) },
    { label: 'Cash balance', value: formatCents(user.next_credits_cents) },
    { label: 'Invested value', value: formatCents(investedValueCents) },
    {
      label: 'Total return',
      value: `${portfolio.totalReturnPct > 0 ? '+' : ''}${portfolio.totalReturnPct}%`,
      delta: formatCents(portfolio.totalReturnCents),
      deltaTone: portfolio.totalReturnCents >= 0 ? 'up' : 'down',
    },
    {
      label: 'Daily return',
      value: `${dailyReturnPct > 0 ? '+' : ''}${dailyReturnPct}%`,
      delta: formatCents(dailyReturnCents),
      deltaTone: dailyReturnCents >= 0 ? 'up' : 'down',
    },
    {
      label: 'Unrealized P&L',
      value: formatCents(totalUnrealizedPnlCents),
      valueTone: totalUnrealizedPnlCents >= 0 ? 'up' : 'down',
    },
    {
      label: 'Realized P&L',
      value: formatCents(totalRealizedPnlCents),
      valueTone: totalRealizedPnlCents >= 0 ? 'up' : 'down',
    },
    ...(bestPosition
      ? [{
          label: 'Best performer',
          value: bestPosition.artist_name,
          delta: `${bestPosition.unrealizedPct >= 0 ? '+' : ''}${bestPosition.unrealizedPct.toFixed(1)}%`,
          deltaTone: 'up' as const,
        }]
      : []),
    ...(worstPosition
      ? [{
          label: 'Worst performer',
          value: worstPosition.artist_name,
          delta: `${worstPosition.unrealizedPct >= 0 ? '+' : ''}${worstPosition.unrealizedPct.toFixed(1)}%`,
          deltaTone: 'down' as const,
        }]
      : []),
  ];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display font-bold text-[34px] m-0 tracking-[-0.01em]">Your Portfolio</h1>
          <p className="mt-1 mb-0 text-sm" style={{ color: 'var(--text-faint)' }}>Paper trading — NEXT Credits have no real monetary value.</p>
        </div>
        <Link href={`/next/profile/${user.id}`} className="next-btn-ghost text-sm px-4 py-2 rounded-[10px]">View your Scout Profile</Link>
      </div>

      <div
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px rounded-2xl overflow-hidden border"
        style={{ background: 'var(--border-soft)', borderColor: 'var(--border-soft)' }}
      >
        {stats.map((s) => <NextStatTile key={s.label} {...s} />)}
      </div>

      {transactions.length > 0 && (
        <div className="next-card p-6">
          <PriceChart points={chartPoints} format="cents" />
        </div>
      )}

      {holdingsWithValue.length > 0 && (
        <AllocationBreakdown holdings={holdingsWithValue} totalValueCents={portfolio.totalValueCents} />
      )}

      <div className="flex flex-col gap-3">
        <h2 className="font-display font-bold text-lg m-0">Holdings</h2>
        {holdingsWithValue.length === 0 && (
          <div className="next-card text-center py-10">
            <p className="m-0" style={{ color: 'var(--text-muted)' }}>No positions yet.</p>
            <p className="mt-1.5 mb-0 text-sm" style={{ color: 'var(--text-faint)' }}>
              Every account starts with {formatCents(user.next_credits_cents)} in virtual NEXT Credits — no real money, ever. Back your first artist to see your portfolio come to life here.
            </p>
            <Link href="/next" className="next-btn-primary mt-4 inline-flex px-5 py-2.5 rounded-[10px] text-sm">Browse NEXT</Link>
          </div>
        )}
        <div className="flex flex-col gap-2.5">
          {holdingsWithValue.map((h) => {
            const up = h.unrealizedPnlCents >= 0;
            return (
              <Link key={h.id} href={`/next/artists/${h.artist_id}`} className="next-card next-card-hover flex flex-col gap-1.5 px-5 py-4">
                <div className="flex items-center gap-4">
                  <ArtistAvatar name={h.artist_name} photoUrl={h.artist_photo_url} />
                  <div className="min-w-0 flex-1">
                    <div className="font-display font-semibold truncate">{h.artist_name}</div>
                    <div className="num text-sm" style={{ color: 'var(--text-muted)' }}>{h.shares.toFixed(4)} shares</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="num font-semibold">{formatCents(h.marketValueCents)}</div>
                    <div className="num text-xs sm:text-sm font-medium" style={{ color: up ? 'var(--up)' : 'var(--down)' }}>
                      {up ? '+' : ''}{formatCents(h.unrealizedPnlCents)} ({up ? '+' : ''}{h.unrealizedPct.toFixed(2)}%)
                    </div>
                  </div>
                </div>
                <div className="num text-xs pl-[72px]" style={{ color: 'var(--text-faint)' }}>
                  Avg: {formatCents(h.cost_basis_cents / h.shares)} · Current: {formatCents(h.price_cents)}
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {transactions.length > 0 && <TransactionHistory transactions={transactions} />}
    </div>
  );
}
