import Link from 'next/link';
import type { Metadata } from 'next';
import { getNextMarket } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { formatCents } from '@/lib/format';
import { recommendation } from '@/lib/scoring';
import { marketSentiment } from '@/lib/next-market';
import ArtistAvatar from '@/components/ArtistAvatar';
import SentimentBadge from '@/components/SentimentBadge';
import Sparkline from '@/components/Sparkline';
import AudioPreview from '@/components/AudioPreview';

export const metadata: Metadata = { title: 'Discover' };
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.map((row) => {
          const rec = recommendation(row.score);
          const sentiment = marketSentiment(row.score, row.priceCents);
          const first = row.priceHistory[0]?.price_cents ?? row.priceCents;
          const changePct = first !== 0 ? ((row.priceCents - first) / first) * 100 : 0;
          const up = changePct >= 0;

          return (
            <div key={row.artist.id} className="card flex flex-col gap-3 hover:border-neutral-600 transition-colors">
              <Link href={`/next/artists/${row.artist.id}`} className="flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <ArtistAvatar name={row.artist.name} photoUrl={row.artist.photo_url} />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold truncate">{row.artist.name}</div>
                    <div className="text-xs text-neutral-500 truncate">
                      {row.artist.genre}{row.artist.genre && row.artist.location ? ' · ' : ''}{row.artist.location}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-semibold">{formatCents(row.priceCents)}</div>
                    <div className={`text-xs font-medium ${up ? 'text-emerald-400' : 'text-red-400'}`}>
                      {up ? '+' : ''}{changePct.toFixed(1)}% {up ? '↗' : '↘'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="badge">{rec.emoji} NEXT {row.score.toFixed(0)}</span>
                  <SentimentBadge sentiment={sentiment} size="sm" />
                </div>

                {(row.artist.growth_velocity_pct != null || row.artist.engagement_rate_pct != null) && (
                  <div className="text-xs text-neutral-400 flex gap-3">
                    {row.artist.growth_velocity_pct != null && <span>30D listeners +{row.artist.growth_velocity_pct}%</span>}
                    {row.artist.engagement_rate_pct != null && <span>{row.artist.engagement_rate_pct}% engagement</span>}
                  </div>
                )}

                {row.artist.why_trending && (
                  <p className="text-xs text-neutral-400 italic line-clamp-2">&ldquo;{row.artist.why_trending}&rdquo;</p>
                )}

                {row.priceHistory.length > 1 && (
                  <Sparkline points={row.priceHistory.map((p) => p.price_cents)} className="w-full h-10" />
                )}
              </Link>

              {row.artist.song_preview_url && (
                <AudioPreview src={row.artist.song_preview_url} label={`Hear ${row.artist.name.split(' ')[0]}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
