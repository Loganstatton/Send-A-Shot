'use client';
import { useEffect, useRef, useState } from 'react';
import { heroGradient } from '@/components/next/heroGradient';
import { track } from '@/lib/track';

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
  const [imgFailed, setImgFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  const boxClass = 'relative w-full h-[280px] md:h-[360px] rounded-[20px] overflow-hidden next-card';

  const bgImageUrl = videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : photoUrl;

  // A broken/expired photo_url or an unavailable YouTube thumbnail both
  // fail silently with a plain CSS background-image — there's no error
  // signal to fall back on, so it just renders an empty box. A real <img>
  // with onError gives us that signal instead. Reset per URL so navigating
  // between artists (this component isn't remounted on client-side nav)
  // doesn't carry a stale failure over to one whose image is fine.
  useEffect(() => {
    setImgFailed(false);
    // The <img src> is present in the server-rendered HTML, so the browser
    // can start loading — and failing — it before React finishes hydrating
    // and attaches onError. A fast failure (DNS, connection refused) can
    // fire and be missed entirely. Catch that race once, right after mount.
    if (imgRef.current?.complete && imgRef.current.naturalWidth === 0) {
      setImgFailed(true);
    }
  }, [bgImageUrl]);

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

  const showImage = Boolean(bgImageUrl) && !imgFailed;

  return (
    <div
      className={`${boxClass} flex items-center justify-center`}
      style={{ background: showImage ? undefined : heroGradient(artistId) }}
    >
      {showImage && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary external URL (Scout-entered photo, or a YouTube thumbnail), not a next/image candidate. */}
          <img
            ref={imgRef}
            src={bgImageUrl}
            alt={name}
            className="absolute inset-0 w-full h-full object-cover"
            onError={() => setImgFailed(true)}
          />
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(180deg, transparent 45%, oklch(15% 0.012 40 / 0.6))' }}
          />
        </>
      )}
      {!showImage && (
        <span className="relative font-display font-extrabold text-[110px]" style={{ color: 'oklch(96% 0.01 90 / 0.22)' }}>
          {initial}
        </span>
      )}
      {videoId && (
        <button
          type="button"
          onClick={() => {
            setPlaying(true);
            track('video_played', { artistId });
          }}
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
