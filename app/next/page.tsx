import type { Metadata } from 'next';
import { getNextMarket, getWatchlistArtistIds } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { marketSentiment } from '@/lib/next-market';
import DiscoverGrid from '@/components/next/DiscoverGrid';
import NextStatTile from '@/components/next/NextStatTile';

export const metadata: Metadata = { title: 'Discover' };
export const dynamic = 'force-dynamic';

export default async function NextMarketPage() {
  const user = await requireUser();
  const rows = getNextMarket();
  const watchedIds = getWatchlistArtistIds(user.id);

  const growthRates = rows.map((r) => r.artist.growth_velocity_pct).filter((v): v is number => v != null);
  const avgGrowth = growthRates.length ? growthRates.reduce((a, b) => a + b, 0) / growthRates.length : null;

  let biggestMover: { name: string; changePct: number } | null = null;
  let mostUndervalued: { name: string; diff: number } | null = null;
  for (const row of rows) {
    const first = row.priceHistory[0]?.price_cents ?? row.priceCents;
    const changePct = first !== 0 ? ((row.priceCents - first) / first) * 100 : 0;
    if (!biggestMover || Math.abs(changePct) > Math.abs(biggestMover.changePct)) {
      biggestMover = { name: row.artist.name, changePct };
    }
    const sentiment = marketSentiment(row.score, row.priceCents);
    if (sentiment.tone === 'undervalued' && (!mostUndervalued || sentiment.diff > mostUndervalued.diff)) {
      mostUndervalued = { name: row.artist.name, diff: sentiment.diff };
    }
  }

  type Stat = { label: string; value: string; valueTone?: 'up' | 'down' | 'ember'; delta?: string; deltaTone?: 'up' | 'down' | 'ember' };
  const stats: Stat[] = [
    { label: 'Artists live', value: String(rows.length) },
    { label: 'Avg. 30D growth', value: avgGrowth != null ? `+${avgGrowth.toFixed(0)}%` : '—', valueTone: 'up' },
    {
      label: "Today's biggest mover",
      value: biggestMover?.name ?? '—',
      delta: biggestMover ? `${biggestMover.changePct >= 0 ? '+' : ''}${biggestMover.changePct.toFixed(1)}%` : undefined,
      deltaTone: (biggestMover?.changePct ?? 0) >= 0 ? 'up' : 'down',
    },
    {
      label: 'Most undervalued',
      value: mostUndervalued?.name ?? 'None right now',
      delta: mostUndervalued ? `+${mostUndervalued.diff.toFixed(0)}` : undefined,
      deltaTone: 'ember',
    },
  ];

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-5 max-w-[720px]">
        <h1 className="font-display font-bold text-[46px] leading-[1.05] tracking-[-0.015em] m-0" style={{ textWrap: 'balance' } as React.CSSProperties}>
          Back breakout artists before <span style={{ color: 'var(--ember)' }}>everyone else does.</span>
        </h1>
        <p className="text-base leading-relaxed m-0 max-w-[58ch]" style={{ color: 'var(--text-muted)' }}>
          NEXT Score predicts momentum from real performance data. NEXT Price is what the market
          currently pays. When the two disagree — that&apos;s the signal.
        </p>
      </div>

      <div
        className="grid grid-cols-2 lg:grid-cols-4 gap-px rounded-2xl overflow-hidden border"
        style={{ background: 'var(--border-soft)', borderColor: 'var(--border-soft)' }}
      >
        {stats.map((s) => <NextStatTile key={s.label} {...s} />)}
      </div>

      {rows.length === 0 ? (
        <div className="next-card text-center py-16" style={{ color: 'var(--text-muted)' }}>
          No artists on the market yet.
        </div>
      ) : (
        <DiscoverGrid rows={rows} watchedIds={watchedIds} />
      )}
    </div>
  );
}
