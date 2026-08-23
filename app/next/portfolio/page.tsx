import Link from 'next/link';
import type { Metadata } from 'next';
import { getPortfolioValue, getUserHoldings, getUserTransactions } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { formatCents } from '@/lib/format';
import ArtistAvatar from '@/components/ArtistAvatar';
import NextStatTile from '@/components/next/NextStatTile';

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
    return { ...h, marketValueCents, unrealizedPnlCents };
  });

  const totalUnrealizedPnlCents = holdingsWithValue.reduce((sum, h) => sum + h.unrealizedPnlCents, 0);
  const totalRealizedPnlCents = transactions.reduce((sum, t) => sum + (t.realized_pnl_cents ?? 0), 0);

  type Stat = { label: string; value: string; valueTone?: 'up' | 'down'; delta?: string; deltaTone?: 'up' | 'down' };
  const stats: Stat[] = [
    { label: 'Portfolio value', value: formatCents(portfolio.totalValueCents) },
    { label: 'Cash balance', value: formatCents(user.next_credits_cents) },
    {
      label: 'Total return',
      value: `${portfolio.totalReturnPct > 0 ? '+' : ''}${portfolio.totalReturnPct}%`,
      delta: formatCents(portfolio.totalReturnCents),
      deltaTone: portfolio.totalReturnCents >= 0 ? 'up' : 'down',
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
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-px rounded-2xl overflow-hidden border"
        style={{ background: 'var(--border-soft)', borderColor: 'var(--border-soft)' }}
      >
        {stats.map((s) => <NextStatTile key={s.label} {...s} />)}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-display font-bold text-lg m-0">Holdings</h2>
        {holdingsWithValue.length === 0 && (
          <div className="next-card text-center py-10">
            <p className="m-0" style={{ color: 'var(--text-muted)' }}>No positions yet.</p>
            <Link href="/next" className="next-btn-primary mt-4 inline-flex px-5 py-2.5 rounded-[10px] text-sm">Browse NEXT</Link>
          </div>
        )}
        <div className="flex flex-col gap-2.5">
          {holdingsWithValue.map((h) => {
            const unrealizedPct = h.cost_basis_cents !== 0 ? (h.unrealizedPnlCents / h.cost_basis_cents) * 100 : 0;
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
                      {up ? '+' : ''}{formatCents(h.unrealizedPnlCents)} ({up ? '+' : ''}{unrealizedPct.toFixed(2)}%)
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

      {transactions.length > 0 && (
        <div className="next-card p-6 flex flex-col gap-3">
          <h2 className="font-display font-bold text-lg m-0">Recent activity</h2>
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-sm min-w-[600px]" style={{ borderCollapse: 'collapse' }}>
              <thead className="text-left">
                <tr>
                  <th className="font-normal pb-2" style={{ color: 'var(--text-faint)' }}>Date</th>
                  <th className="font-normal pb-2" style={{ color: 'var(--text-faint)' }}>Artist</th>
                  <th className="font-normal pb-2" style={{ color: 'var(--text-faint)' }}>Type</th>
                  <th className="font-normal pb-2 text-right" style={{ color: 'var(--text-faint)' }}>Shares</th>
                  <th className="font-normal pb-2 text-right" style={{ color: 'var(--text-faint)' }}>Price</th>
                  <th className="font-normal pb-2 text-right" style={{ color: 'var(--text-faint)' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr key={t.id} style={{ borderTop: '1px solid var(--border-soft)' }}>
                    <td className="py-2.5" style={{ color: 'var(--text-faint)' }}>{new Date(t.created_at).toLocaleDateString()}</td>
                    <td className="py-2.5">
                      <Link href={`/next/artists/${t.artist_id}`} className="hover:underline">{t.artist_name}</Link>
                    </td>
                    <td className="py-2.5">
                      <span
                        className="next-pill"
                        style={
                          t.type === 'buy'
                            ? { background: 'var(--up-dim)', borderColor: 'var(--up)', color: 'var(--up)', padding: '3px 10px', fontSize: 12 }
                            : { background: 'var(--down-dim)', borderColor: 'var(--down)', color: 'var(--down)', padding: '3px 10px', fontSize: 12 }
                        }
                      >
                        {t.type === 'buy' ? 'Buy' : 'Sell'}
                      </span>
                    </td>
                    <td className="num py-2.5 text-right">{t.shares.toFixed(4)}</td>
                    <td className="num py-2.5 text-right">{formatCents(t.price_cents_per_share)}</td>
                    <td className="num py-2.5 text-right">{formatCents(Math.abs(t.credits_delta_cents))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
