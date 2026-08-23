'use client';
import { useRef, useState } from 'react';

// A single play/pause button backed by a hidden <audio> element. Stops
// itself at 30s so a "preview" can't accidentally play a full track.
// variant="icon" is the compact round button used on NEXT's Discover cards;
// default keeps the original labeled-pill look used elsewhere.
export default function AudioPreview({
  src,
  label = 'Hear',
  variant = 'default',
}: {
  src: string;
  label?: string;
  variant?: 'default' | 'icon';
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const audio = ref.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }
  }

  const audioEl = (
    <audio
      ref={ref}
      src={src}
      preload="none"
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onEnded={() => setPlaying(false)}
      onTimeUpdate={(e) => {
        if (e.currentTarget.currentTime >= 30) e.currentTarget.pause();
      }}
      className="hidden"
    />
  );

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pause preview' : label}
        className="next-icon-btn w-[34px] h-[34px] rounded-full flex items-center justify-center shrink-0 border active:scale-90"
        style={{ background: 'var(--surface-2)', borderColor: 'var(--border-soft)' }}
      >
        {playing ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="var(--text)"><rect x="5" y="4" width="5" height="16" /><rect x="14" y="4" width="5" height="16" /></svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="var(--text)"><path d="M6 4 20 12 6 20Z" /></svg>
        )}
        {audioEl}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={`btn text-sm ${playing ? 'bg-white/20' : ''}`}
    >
      {playing ? '⏸ Playing' : `▶ ${label}`}
      {audioEl}
    </button>
  );
}
