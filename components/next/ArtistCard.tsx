'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { NextMarketRow } from '@/lib/types';
import { formatCents } from '@/lib/format';
import { marketSentiment } from '@/lib/next-market';
import AudioPreview from '@/components/AudioPreview';
import ScoreGapBar from '@/components/next/ScoreGapBar';
import PriceSparkline from '@/components/next/PriceSparkline';
import WatchButton from '@/components/next/WatchButton';
import { heroGradient } from '@/components/next/heroGradient';
import InfoTip from '@/components/next/InfoTip';

export default function ArtistCard({
  row,
  hotSignal = false,
  watching = false,
}: {
  row: NextMarketRow;
  hotSignal?: boolean;
  watching?: boolean;
}) {
  const { artist, score, priceCents, priceHistory } = row;
  const sentiment = marketSentiment(score, priceCents);
  const first = priceHistory[0]?.price_cents ?? priceCents;
  const changePct = first !== 0 ? ((priceCents - first) / first) * 100 : 0;
  const up = changePct >= 0;
  const undervalued = sentiment.tone === 'undervalued';

  // A Scout-curated photo wins when there is one; otherwise fall back to
  // the YouTube thumbnail for whatever video Discovery/Approve attached —
  // still a real image of the artist, just less deliberately chosen.
  const heroImageUrl = artist.photo_url || (artist.featured_video_id ? `https://img.youtube.com/vi/${artist.featured_video_id}/hqdefault.jpg` : undefined);

  const [imgFailed, setImgFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  // Same SSR-hydration race as VideoBanner.tsx: the <img> in the
  // server-rendered HTML can start loading — and failing — before React
  // hydrates and attaches onError, so a fast failure would otherwise go
  // unnoticed and leave a blank tile. Caught here right after mount.
  useEffect(() => {
    setImgFailed(false);
    if (imgRef.current?.complete && imgRef.current.naturalWidth === 0) setImgFailed(true);
  }, [heroImageUrl]);
  const showImage = Boolean(heroImageUrl) && !imgFailed;

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
    <div className="next-card next-card-hover relative flex flex-col overflow-hidden transition-transform active:scale-[0.98]">
      {hotSignal && (
        <div
          className="absolute top-4 left-4 z-10 flex items-center gap-[5px] pl-2 pr-2.5 py-[5px] rounded-full backdrop-blur-sm border"
          style={{ background: 'oklch(15% 0.012 40 / 0.72)', borderColor: 'var(--ember-line)' }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--ember)" strokeWidth={2.5}><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" /></svg>
          <span className="text-[11px] font-semibold font-mono" style={{ color: 'var(--ember)' }}>HOT SIGNAL</span>
        </div>
      )}

      <div className="absolute top-4 right-4 z-10">
        <WatchButton artistId={artist.id} initialWatching={watching} />
      </div>

      <Link href={`/next/artists/${artist.id}`} className="flex flex-col gap-3">
        <div className="next-card-hero-zoom relative h-[200px] flex items-center justify-center" style={{ background: showImage ? undefined : heroGradient(artist.id) }}>
          {showImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- see ArtistAvatar.tsx: arbitrary Scout-entered/YouTube-thumbnail URL, not a next/image candidate.
            <img ref={imgRef} src={heroImageUrl} alt={artist.name} onError={() => setImgFailed(true)} className="absolute inset-0 w-full h-full object-cover" />
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
            <div className="flex-1 flex items-center gap-1.5">
              <ScoreGapBar score={score} sentiment={sentiment} />
              <InfoTip
                label="NEXT Score vs. Price"
                text="Score is our read on real momentum. Price is what the market currently pays. When Score runs ahead of Price, the artist is undervalued."
              />
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
