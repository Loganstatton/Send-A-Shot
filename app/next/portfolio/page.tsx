import Link from 'next/link';
import { getUserHoldings, getUserTransactions } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { formatCents } from '@/lib/format';
import StatTile from '@/components/StatTile';

export const dynamic = 'force-dynamic';

export default async function NextPortfolioPage() {
  const user = await requireUser();
  const holdings = getUserHoldings(user.id);
  const transactions = getUserTransactions(user.id);

  const holdingsWithValue = holdings.map((h) => {
    const marketValueCents = Math.round(h.shares * h.price_cents);
    const unrealizedPnlCents = marketValueCents - h.cost_basis_cents;
    return { ...h, marketValueCents, unrealizedPnlCents };
  });

  const totalHoldingsValueCents = holdingsWithValue.reduce((sum, h) => sum + h.marketValueCents, 0);
  const totalUnrealizedPnlCents = holdingsWithValue.reduce((sum, h) => sum + h.unrealizedPnlCents, 0);
  const totalRealizedPnlCents = transactions.reduce((sum, t) => sum + (t.realized_pnl_cents ?? 0), 0);
  const totalPortfolioValueCents = user.next_credits_cents + totalHoldingsValueCents;
  const totalReturnCents = totalPortfolioValueCents - 1_000_000; // started with $10,000
  const totalReturnPct = Math.round((totalReturnCents / 1_000_000) * 1000) / 10;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Your Portfolio</h1>
        <p className="text-neutral-400 text-sm">Paper trading — NEXT Credits have no real monetary value.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatTile label="Portfolio value" value={formatCents(totalPortfolioValueCents)} />
        <StatTile label="Cash balance" value={formatCents(user.next_credits_cents)} />
        <StatTile
          label="Total return"
          value={`${totalReturnPct > 0 ? '+' : ''}${totalReturnPct}%`}
          delta={formatCents(totalReturnCents)}
          deltaTone={totalReturnCents >= 0 ? 'up' : 'down'}
        />
        <StatTile
          label="Unrealized P&L"
          value={formatCents(totalUnrealizedPnlCents)}
          deltaTone={totalUnrealizedPnlCents >= 0 ? 'up' : 'down'}
        />
        <StatTile
          label="Realized P&L"
          value={formatCents(totalRealizedPnlCents)}
          deltaTone={totalRealizedPnlCents >= 0 ? 'up' : 'down'}
        />
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold text-lg">Holdings</h2>
        {holdingsWithValue.length === 0 && (
          <div className="text-center py-8">
            <p className="text-neutral-400">No positions yet.</p>
            <Link href="/next" className="btn btn-primary mt-4 inline-flex">Browse NEXT</Link>
          </div>
        )}
        {holdingsWithValue.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead className="text-neutral-500 text-left">
                <tr>
                  <th className="font-normal pb-2">Artist</th>
                  <th className="font-normal pb-2 text-right">Shares</th>
                  <th className="font-normal pb-2 text-right">Avg cost</th>
                  <th className="font-normal pb-2 text-right">Price</th>
                  <th className="font-normal pb-2 text-right">Value</th>
                  <th className="font-normal pb-2 text-right">P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {holdingsWithValue.map((h) => (
                  <tr key={h.id} className="border-t border-neutral-800">
                    <td className="py-2">
                      <Link href={`/next/artists/${h.artist_id}`} className="font-medium hover:underline">{h.artist_name}</Link>
                    </td>
                    <td className="py-2 text-right">{h.shares.toFixed(4)}</td>
                    <td className="py-2 text-right">{formatCents(h.cost_basis_cents / h.shares)}</td>
                    <td className="py-2 text-right">{formatCents(h.price_cents)}</td>
                    <td className="py-2 text-right">{formatCents(h.marketValueCents)}</td>
                    <td className={`py-2 text-right font-medium ${h.unrealizedPnlCents >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {h.unrealizedPnlCents >= 0 ? '+' : ''}{formatCents(h.unrealizedPnlCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {transactions.length > 0 && (
        <div className="card space-y-3">
          <h2 className="font-semibold text-lg">Recent activity</h2>
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead className="text-neutral-500 text-left">
                <tr>
                  <th className="font-normal pb-2">Date</th>
                  <th className="font-normal pb-2">Artist</th>
                  <th className="font-normal pb-2">Type</th>
                  <th className="font-normal pb-2 text-right">Shares</th>
                  <th className="font-normal pb-2 text-right">Price</th>
                  <th className="font-normal pb-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr key={t.id} className="border-t border-neutral-800">
                    <td className="py-2 text-neutral-400">{new Date(t.created_at).toLocaleDateString()}</td>
                    <td className="py-2">
                      <Link href={`/next/artists/${t.artist_id}`} className="hover:underline">{t.artist_name}</Link>
                    </td>
                    <td className="py-2">
                      <span className={`badge ${t.type === 'buy' ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-red-500/20 border-red-500/40 text-red-300'}`}>
                        {t.type === 'buy' ? 'Buy' : 'Sell'}
                      </span>
                    </td>
                    <td className="py-2 text-right">{t.shares.toFixed(4)}</td>
                    <td className="py-2 text-right">{formatCents(t.price_cents_per_share)}</td>
                    <td className="py-2 text-right">{formatCents(Math.abs(t.credits_delta_cents))}</td>
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
