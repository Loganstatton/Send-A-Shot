'use client';
import { useNowPlaying } from '@/components/next/NowPlayingProvider';

// A trigger button for the shared mini-player (NowPlayingProvider +
// MiniPlayer) — this file used to own its own <audio> element per
// instance; now every preview button on NEXT shares the one player, which
// is what makes "only one artist plays at once" and "keep playing while
// browsing" possible. variant="icon" is the compact round button used on
// Discover cards; default is the labeled-pill look used on Artist Detail.
export default function AudioPreview({
  artistId,
  artistName,
  src,
  variant = 'default',
}: {
  artistId: number;
  artistName: string;
  src?: string;
  variant?: 'default' | 'icon';
}) {
  const { track, playing, toggle } = useNowPlaying();
  const isCurrent = track?.artistId === artistId;
  const isPlaying = isCurrent && playing;
  const available = Boolean(src);

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!available || !src) return;
    toggle({ artistId, artistName, src });
  }

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={!available}
        aria-label={!available ? 'Preview unavailable' : isPlaying ? 'Pause preview' : `Hear ${artistName.split(' ')[0]}`}
        title={!available ? 'No preview available for this artist yet' : undefined}
        className="next-icon-btn w-[34px] h-[34px] rounded-full flex items-center justify-center shrink-0 border active:scale-90 disabled:active:scale-100 disabled:cursor-default"
        style={{ background: 'var(--surface-2)', borderColor: 'var(--border-soft)', opacity: available ? 1 : 0.4 }}
      >
        {isPlaying ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="var(--text)"><rect x="5" y="4" width="5" height="16" /><rect x="14" y="4" width="5" height="16" /></svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="var(--text)"><path d="M6 4 20 12 6 20Z" /></svg>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!available}
      title={!available ? 'No preview available for this artist yet' : undefined}
      className={`btn text-sm ${isPlaying ? 'bg-white/20' : ''} ${!available ? 'opacity-40 cursor-default' : ''}`}
    >
      {!available ? 'Preview unavailable' : isPlaying ? '⏸ Playing' : `▶ Hear ${artistName.split(' ')[0]}`}
    </button>
  );
}
