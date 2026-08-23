'use client';
import { useState } from 'react';
import { heroGradient } from '@/components/next/heroGradient';

// The Artist Detail hero. A featured_video_id (see lib/db.ts) shows as a
// real YouTube thumbnail with a play button; clicking swaps in a live
// embed — no page navigation, no autoplaying video nobody asked for. Falls
// back to the artist's photo, then to the same gradient+initial treatment
// Discover's cards use when there's nothing else to show.
export default function VideoBanner({
  artistId,
  name,
  videoId,
  photoUrl,
}: {
  artistId: number;
  name: string;
  videoId?: string;
  photoUrl?: string;
}) {
  const [playing, setPlaying] = useState(false);
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  const boxClass = 'relative w-full h-[280px] md:h-[360px] rounded-[20px] overflow-hidden next-card';

  if (playing && videoId) {
    return (
      <div className={boxClass}>
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1`}
          title={`${name} — featured video`}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 w-full h-full border-0"
        />
      </div>
    );
  }

  const bgImage = videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : photoUrl;

  return (
    <div
      className={`${boxClass} flex items-center justify-center`}
      style={{
        backgroundImage: bgImage ? `url(${bgImage})` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        background: bgImage ? undefined : heroGradient(artistId),
      }}
    >
      {bgImage && (
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(180deg, transparent 45%, oklch(15% 0.012 40 / 0.6))' }}
        />
      )}
      {!bgImage && (
        <span className="relative font-display font-extrabold text-[110px]" style={{ color: 'oklch(96% 0.01 90 / 0.22)' }}>
          {initial}
        </span>
      )}
      {videoId && (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label={`Play video — ${name}`}
          className="relative w-16 h-16 rounded-full flex items-center justify-center border transition-transform hover:scale-105"
          style={{ background: 'oklch(15% 0.012 40 / 0.72)', borderColor: 'var(--ember-line)', backdropFilter: 'blur(6px)' }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="var(--ember)"><path d="M6 4 20 12 6 20Z" /></svg>
        </button>
      )}
    </div>
  );
}
