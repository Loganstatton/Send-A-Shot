import { notFound } from 'next/navigation';
import { getHolding, getNextArtist } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { formatCents } from '@/lib/format';
import { recommendation } from '@/lib/scoring';
import Sparkline from '@/components/Sparkline';
import TradePanel from '@/components/TradePanel';

export const dynamic = 'force-dynamic';

// Public-safe view only: name, genre, location, public socials, public
// growth metrics, NEXT Score, NEXT Price. Deliberately excludes stage,
// scout_name, notes, created_by — that's Scout's internal view, not NEXT's.
export default async function NextArtistPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const id = Number(params.id);
  if (!Number.isInteger(id)) notFound();
  const row = getNextArtist(id);
  if (!row) notFound();

  const { artist, score, priceCents, priceHistory } = row;
  const rec = recommendation(score);
  const holding = getHolding(user.id, id);

  const links = [
    { label: 'TikTok', url: artist.tiktok_url },
    { label: 'Instagram', url: artist.instagram_url },
    { label: 'YouTube', url: artist.youtube_url },
    { label: 'Spotify', url: artist.spotify_url },
    { label: 'SoundCloud', url: artist.soundcloud_url },
  ].filter((l) => l.url);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{artist.name}</h1>
          <p className="text-neutral-400 text-sm">
            {artist.genre}{artist.genre && artist.location ? ' · ' : ''}{artist.location}
          </p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-semibold">{formatCents(priceCents)}</div>
          <div className="text-xs text-neutral-500">NEXT Price</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-neutral-400">Price history</span>
              <span className="font-semibold">
                NEXT Score {score.toFixed(0)} {rec.emoji} <span className="text-neutral-500 font-normal">{rec.label}</span>
              </span>
            </div>
            {priceHistory.length > 1 ? (
              <Sparkline points={priceHistory.map((p) => p.price_cents)} className="w-full h-32" />
            ) : (
              <p className="text-sm text-neutral-500 py-8 text-center">No trades yet — this is the starting price.</p>
            )}
          </div>

          <div className="card">
            <h2 className="font-semibold text-lg mb-3">Momentum</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-neutral-500">Followers</div>
                <div className="text-lg font-semibold">{artist.followers_count?.toLocaleString() ?? '—'}</div>
              </div>
              <div>
                <div className="text-neutral-500">Monthly listeners</div>
                <div className="text-lg font-semibold">{artist.monthly_listeners?.toLocaleString() ?? '—'}</div>
              </div>
              <div>
                <div className="text-neutral-500">30-day growth</div>
                <div className="text-lg font-semibold">{artist.growth_velocity_pct != null ? `+${artist.growth_velocity_pct}%` : '—'}</div>
              </div>
              <div>
                <div className="text-neutral-500">Engagement</div>
                <div className="text-lg font-semibold">{artist.engagement_rate_pct != null ? `${artist.engagement_rate_pct}%` : '—'}</div>
              </div>
            </div>
            {links.length > 0 && (
              <div className="flex gap-3 flex-wrap mt-4 pt-4 border-t border-neutral-800">
                {links.map((l) => (
                  <a key={l.label} href={l.url} target="_blank" rel="noreferrer" className="btn text-sm">{l.label}</a>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          <TradePanel
            artistId={id}
            priceCents={priceCents}
            ownedShares={holding?.shares ?? 0}
            costBasisCents={holding?.cost_basis_cents ?? 0}
            creditsCents={user.next_credits_cents}
          />
        </div>
      </div>
    </div>
  );
}
