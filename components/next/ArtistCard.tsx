import Link from 'next/link';
import { NextMarketRow } from '@/lib/types';
import { formatCents } from '@/lib/format';
import { marketSentiment } from '@/lib/next-market';
import ArtistAvatar from '@/components/ArtistAvatar';
import AudioPreview from '@/components/AudioPreview';
import ScoreGapBar from '@/components/next/ScoreGapBar';
import PriceSparkline from '@/components/next/PriceSparkline';
import { heroGradient } from '@/components/next/heroGradient';

export default function ArtistCard({ row, hotSignal = false }: { row: NextMarketRow; hotSignal?: boolean }) {
  const { artist, score, priceCents, priceHistory } = row;
  const sentiment = marketSentiment(score, priceCents);
  const first = priceHistory[0]?.price_cents ?? priceCents;
  const changePct = first !== 0 ? ((priceCents - first) / first) * 100 : 0;
  const up = changePct >= 0;
  const undervalued = sentiment.tone === 'undervalued';

  const blurb =
    artist.growth_velocity_pct != null || artist.engagement_rate_pct != null
      ? [
          artist.growth_velocity_pct != null ? `+${artist.growth_velocity_pct}% listeners in 30D` : null,
          artist.engagement_rate_pct != null ? `${artist.engagement_rate_pct}% engagement` : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : artist.why_trending || null;

  return (
    <div className="next-card relative flex flex-col overflow-hidden">
      {hotSignal && (
        <div
          className="absolute top-4 left-4 z-10 flex items-center gap-[5px] pl-2 pr-2.5 py-[5px] rounded-full backdrop-blur-sm border"
          style={{ background: 'oklch(15% 0.012 40 / 0.72)', borderColor: 'var(--ember-line)' }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--ember)" strokeWidth={2.5}><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" /></svg>
          <span className="text-[11px] font-semibold font-mono" style={{ color: 'var(--ember)' }}>HOT SIGNAL</span>
        </div>
      )}

      <Link href={`/next/artists/${artist.id}`} className="flex flex-col gap-3">
        <div className="h-[200px] flex items-center justify-center" style={{ background: artist.photo_url ? undefined : heroGradient(artist.id) }}>
          {artist.photo_url ? (
            <ArtistAvatar name={artist.name} photoUrl={artist.photo_url} size="lg" />
          ) : (
            <span className="font-display font-extrabold text-[64px]" style={{ color: 'oklch(96% 0.01 90 / 0.28)' }}>
              {artist.name.trim().charAt(0).toUpperCase() || '?'}
            </span>
          )}
        </div>

        <div className="px-5 pt-[18px] pb-5 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2.5">
            <div className="min-w-0">
              <div className="font-display font-bold text-[19px] truncate">{artist.name}</div>
              <div className="text-[12.5px] truncate mt-0.5" style={{ color: 'var(--text-faint)' }}>
                {artist.genre}{artist.genre && artist.location ? ' · ' : ''}{artist.location}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="num text-[17px] font-bold">{formatCents(priceCents)}</div>
              <div className="num text-xs font-semibold flex items-center gap-0.5 justify-end" style={{ color: up ? 'var(--up)' : 'var(--down)' }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill={up ? 'var(--up)' : 'var(--down)'}>
                  {up ? <path d="M12 4 20 16H4Z" /> : <path d="M12 20 4 8h16Z" />}
                </svg>
                {up ? '+' : ''}{changePct.toFixed(1)}%
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border" style={{ background: 'var(--surface-2)', borderColor: 'var(--border-soft)' }}>
              <span className="text-[11px] font-mono" style={{ color: 'var(--text-faint)' }}>SCORE</span>
              <span className="num text-sm font-bold">{score.toFixed(0)}</span>
            </div>
            <div className="flex-1">
              <ScoreGapBar score={score} sentiment={sentiment} />
            </div>
          </div>

          {blurb && (
            <div
              className="px-3 py-2.5 rounded-[10px] border text-xs leading-snug"
              style={
                undervalued
                  ? { background: 'var(--ember-dim)', borderColor: 'var(--ember-line)', color: 'var(--on-ember-soft)' }
                  : { background: 'var(--surface-2)', borderColor: 'var(--border-soft)', color: 'var(--text-muted)' }
              }
            >
              {blurb}
            </div>
          )}

          {priceHistory.length > 1 && <PriceSparkline points={priceHistory.map((p) => p.price_cents)} filled={hotSignal} />}
        </div>
      </Link>

      <div className="px-5 pb-5 flex items-center gap-2.5">
        {artist.song_preview_url && <AudioPreview src={artist.song_preview_url} label={`Hear ${artist.name.split(' ')[0]}`} variant="icon" />}
        <Link
          href={`/next/artists/${artist.id}`}
          className={`flex-1 text-center py-2.5 rounded-[10px] text-[13.5px] font-bold ${undervalued ? 'next-btn-primary' : 'next-btn-ghost'}`}
        >
          Back this artist
        </Link>
      </div>
    </div>
  );
}
