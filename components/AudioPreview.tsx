'use client';
import { useRef, useState } from 'react';

// A single play/pause button backed by a hidden <audio> element. Stops
// itself at 30s so a "preview" can't accidentally play a full track.
export default function AudioPreview({ src, label = 'Hear' }: { src: string; label?: string }) {
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

  return (
    <button
      type="button"
      onClick={toggle}
      className={`btn text-sm ${playing ? 'bg-white/20' : ''}`}
    >
      {playing ? '⏸ Playing' : `▶ ${label}`}
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
    </button>
  );
}
