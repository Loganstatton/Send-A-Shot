import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getArtist, getFoundingBelieverCountForArtist, getFoundingBelieverRecord, getHolding, getNextArtist, getScoreHistory } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { formatCents } from '@/lib/format';
import { recommendation } from '@/lib/scoring';
import { marketSentiment } from '@/lib/next-market';
import ArtistAvatar from '@/components/ArtistAvatar';
import SentimentBadge from '@/components/SentimentBadge';
import AudioPreview from '@/components/AudioPreview';
import SpotifyPreview from '@/components/SpotifyPreview';
import PriceChart from '@/components/PriceChart';
import TradePanel from '@/components/TradePanel';

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const artist = getArtist(Number(params.id));
  return { title: artist?.name ?? 'Artist' };
}

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
  const sentiment = marketSentiment(score, priceCents);
  const holding = getHolding(user.id, id);
  const scoreHistory = getScoreHistory(id);
  const foundingRecord = getFoundingBelieverRecord(user.id, id);
  const backerCount = getFoundingBelieverCountForArtist(id);

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
        <div className="flex items-center gap-4">
          <ArtistAvatar name={artist.name} photoUrl={artist.photo_url} size="lg" />
          <div>
            <h1 className="text-2xl font-semibold">{artist.name}</h1>
            <p className="text-neutral-400 text-sm">
              {artist.genre}{artist.genre && artist.location ? ' · ' : ''}{artist.location}
            </p>
            <div className="flex items-center gap-2 flex-wrap mt-2">
              <span className="badge text-xs">{rec.emoji} NEXT {score.toFixed(0)}</span>
              <SentimentBadge sentiment={sentiment} size="sm" />
              {artist.song_preview_url && <AudioPreview src={artist.song_preview_url} label={`Hear ${artist.name.split(' ')[0]}`} />}
            </div>
            {backerCount > 0 && (
              <p className="text-xs text-neutral-500 mt-2">🏆 {backerCount} Scout{backerCount === 1 ? '' : 's'} backed this artist</p>
            )}
          </div>
        </div>
      </div>

      {artist.bio && <p className="text-neutral-300 text-sm max-w-2xl">{artist.bio}</p>}

      <SpotifyPreview trackUrl={artist.top_song_url} artistUrl={artist.spotify_url} />

      {foundingRecord && (
        <div className="card border-amber-500/30 bg-amber-500/5">
          <p className="font-semibold text-amber-300">🏆 Founding Believer</p>
          <p className="text-sm text-neutral-300 mt-1">
            You backed {artist.name} on {new Date(foundingRecord.purchased_at).toLocaleDateString()}
            {foundingRecord.followers_count != null && (
              <> — {foundingRecord.followers_count.toLocaleString()} followers then, {artist.followers_count?.toLocaleString() ?? '—'} today</>
            )}
            . You were the #{foundingRecord.discovery_rank} person to back them.
          </p>
          <p className="text-xs text-neutral-500 mt-1">This stays true even if you&apos;ve since sold — being early doesn&apos;t expire.</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="card">
            <div className="text-sm text-neutral-400 mb-1">NEXT Price</div>
            <PriceChart points={priceHistory.map((p) => ({ recorded_at: p.recorded_at, value: p.price_cents }))} format="cents" />
          </div>

          <div className="card">
            <div className="text-sm text-neutral-400 mb-1">NEXT Score</div>
            <PriceChart
              points={scoreHistory.map((s) => ({ recorded_at: s.recorded_at, value: s.breakout_score }))}
              format="number"
            />
            <p className="text-xs text-neutral-500 mt-2">
              This is the fundamentals history — see when the algorithm spotted momentum before the price caught up.
            </p>
          </div>

          {sentiment.tone !== 'fair' && (
            <div className={`card text-sm ${sentiment.tone === 'undervalued' ? 'border-emerald-500/30' : 'border-red-500/30'}`}>
              <p className={sentiment.tone === 'undervalued' ? 'text-emerald-300' : 'text-red-300'}>
                {sentiment.tone === 'undervalued'
                  ? 'The market hasn’t priced in the fundamentals yet — NEXT Score is running ahead of NEXT Price.'
                  : 'The market is pricing this artist considerably above what their fundamental momentum currently shows.'}
              </p>
            </div>
          )}

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
            {artist.top_song_url && (
              <div className="mt-4 pt-4 border-t border-neutral-800">
                <a href={artist.top_song_url} target="_blank" rel="noreferrer" className="btn text-sm">▶ Top song</a>
              </div>
            )}
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
