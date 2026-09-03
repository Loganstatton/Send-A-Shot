import Link from 'next/link';
import { NextMarketRow } from '@/lib/types';
import { formatCents } from '@/lib/format';
import { marketSentiment } from '@/lib/next-market';
import { heroGradient } from '@/components/next/heroGradient';
import ScoreGapBar from '@/components/next/ScoreGapBar';
import { getArtistAvatarUrl } from '@/lib/artist-image';

// The one module on Discover that leans fully on imagery — a large photo
// (or the same gradient+initial fallback as the grid, just bigger) instead
// of the compact card treatment everything else uses. Picked server-side
// (see app/next/page.tsx: highest Score-vs-Price gap among undervalued
// artists, or the top Score if nothing's currently undervalued) — this is
// the single artist Discover is most trying to surface, so it gets the
// biggest visual bet on the page.
export default function FeaturedArtist({ row }: { row: NextMarketRow }) {
  const { artist, score, priceCents } = row;
  const sentiment = marketSentiment(score, priceCents);
  const undervalued = sentiment.tone === 'undervalued';

  const blurb = artist.why_trending || null;
  const avatarUrl = getArtistAvatarUrl(artist);

  return (
    <Link href={`/next/artists/${artist.id}`} className="next-card next-card-hover block overflow-hidden relative">
      <div className="absolute top-4 left-4 z-10 flex items-center gap-1.5 pl-2.5 pr-3 py-[6px] rounded-full backdrop-blur-sm border" style={{ background: 'oklch(15% 0.012 40 / 0.72)', borderColor: 'var(--ember-line)' }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ember)" strokeWidth={2.5}><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" /></svg>
        <span className="text-[11.5px] font-semibold font-mono" style={{ color: 'var(--ember)' }}>TODAY&apos;S BREAKOUT PICK</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1.3fr_1fr]">
        <div
          className="next-card-hero-zoom relative h-[220px] md:h-[320px] flex items-center justify-center"
          style={{ background: avatarUrl ? undefined : heroGradient(artist.id) }}
        >
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- arbitrary Scout-entered URL, not a next/image candidate.
            <img src={avatarUrl} alt={artist.name} className="absolute inset-0 w-full h-full object-cover" />
          ) : (
            <span className="font-display font-extrabold text-[96px]" style={{ color: 'oklch(96% 0.01 90 / 0.28)' }}>
              {artist.name.trim().charAt(0).toUpperCase() || '?'}
            </span>
          )}
        </div>

        <div className="p-6 md:p-8 flex flex-col justify-center gap-3.5">
          <div>
            <div className="font-display font-bold text-[26px] leading-tight">{artist.name}</div>
            <div className="text-[13px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
              {artist.genre}{artist.genre && artist.location ? ' · ' : ''}{artist.location}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="num text-[22px] font-bold">{formatCents(priceCents)}</div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border" style={{ background: 'var(--surface-2)', borderColor: 'var(--border-soft)' }}>
              <span className="text-[11px] font-mono" style={{ color: 'var(--text-faint)' }}>SCORE</span>
              <span className="num text-sm font-bold">{score.toFixed(0)}</span>
            </div>
          </div>

          <ScoreGapBar score={score} sentiment={sentiment} />

          {blurb && (
            <div
              className="px-3 py-2.5 rounded-[10px] border text-xs leading-snug w-fit"
              style={undervalued
                ? { background: 'var(--ember-dim)', borderColor: 'var(--ember-line)', color: 'var(--on-ember-soft)' }
                : { background: 'var(--surface-2)', borderColor: 'var(--border-soft)', color: 'var(--text-muted)' }}
            >
              {blurb}
            </div>
          )}

          <span className="next-btn-primary w-fit px-5 py-2.5 rounded-[10px] text-[13.5px] font-bold mt-1">
            Back this artist
          </span>
        </div>
      </div>
    </Link>
  );
}
