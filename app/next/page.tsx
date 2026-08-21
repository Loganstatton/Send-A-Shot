import Link from 'next/link';
import { getNextMarket } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { formatCents } from '@/lib/format';
import { recommendation } from '@/lib/scoring';
import Sparkline from '@/components/Sparkline';

export const dynamic = 'force-dynamic';

export default async function NextMarketPage() {
  await requireUser();
  const rows = getNextMarket().sort((a, b) => b.score - a.score);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">NEXT — Discover them before everyone else</h1>
        <p className="text-neutral-400 text-sm">
          NEXT Score predicts breakout momentum. NEXT Price is what the community currently pays.
          When they disagree, that&apos;s the signal.
        </p>
      </div>

      {rows.length === 0 && (
        <div className="card text-center py-12">
          <p className="text-neutral-400">No artists on the market yet.</p>
        </div>
      )}

      <div className="space-y-3">
        {rows.map((row) => {
          const rec = recommendation(row.score);
          return (
            <Link
              key={row.artist.id}
              href={`/next/artists/${row.artist.id}`}
              className="card flex items-center justify-between gap-4 hover:border-neutral-600 transition-colors"
            >
              <div className="flex items-center gap-4 min-w-0 flex-1">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold truncate">{row.artist.name}</span>
                    {row.artist.genre && <span className="text-xs text-neutral-500">{row.artist.genre}</span>}
                  </div>
                  <div className="text-sm text-neutral-400 mt-1">
                    NEXT Score <strong className="text-white">{row.score.toFixed(0)}</strong> {rec.emoji}
                  </div>
                </div>
                <div className="w-28 shrink-0 hidden sm:block">
                  {row.priceHistory.length > 1 && (
                    <Sparkline points={row.priceHistory.map((p) => p.price_cents)} className="w-24 h-8" />
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-lg font-semibold">{formatCents(row.priceCents)}</div>
                <div className="text-xs text-neutral-500">NEXT Price</div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
