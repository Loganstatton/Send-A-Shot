'use client';
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import MiniPlayer from '@/components/next/MiniPlayer';

export type NowPlayingTrack = { artistId: number; artistName: string; src: string };

type NowPlayingContextValue = {
  track: NowPlayingTrack | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  toggle: (track: NowPlayingTrack) => void;
  close: () => void;
};

const NowPlayingContext = createContext<NowPlayingContextValue | null>(null);

// A 30-second "preview," not the full track — same cap the old
// per-card <audio> elements enforced individually.
const PREVIEW_CAP_SEC = 30;

export function useNowPlaying(): NowPlayingContextValue {
  const ctx = useContext(NowPlayingContext);
  if (!ctx) throw new Error('useNowPlaying must be used within NowPlayingProvider');
  return ctx;
}

// One <audio> element for the entire NEXT section, mounted once here in
// the layout rather than one per card. That single-element design is what
// actually guarantees "only one artist plays at once" and "starting a new
// preview stops the last one" — there's physically nowhere for a second
// stream to come from. Also what makes "keep playing while browsing NEXT"
// possible: this provider lives in app/next/layout.tsx, which doesn't
// remount on client-side navigation between /next pages, so playback
// survives moving from Discover to an Artist Detail page and back.
export default function NowPlayingProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [track, setTrack] = useState<NowPlayingTrack | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Best-effort by design — see app/api/next/preview-listen/route.ts. A
  // failed beacon should never interrupt someone's music.
  const logEvent = useCallback((artistId: number, event: 'started' | 'completed') => {
    fetch('/api/next/preview-listen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artistId, event }),
    }).catch(() => {});
  }, []);

  const toggle = useCallback(
    (next: NowPlayingTrack) => {
      const audio = audioRef.current;
      if (!audio) return;
      if (track?.artistId === next.artistId) {
        if (playing) {
          audio.pause();
        } else {
          audio.play().catch(() => {});
          logEvent(next.artistId, 'started'); // a resume still counts as a listen
        }
        return;
      }
      // Switching artists: the single shared <audio> element re-sourcing
      // is what stops the previous preview — no separate "stop" call needed.
      setTrack(next);
      setCurrentTime(0);
      setDuration(0);
      audio.src = next.src;
      audio.currentTime = 0;
      audio.play().catch(() => {});
      logEvent(next.artistId, 'started');
    },
    [track, playing, logEvent]
  );

  const close = useCallback(() => {
    audioRef.current?.pause();
    setTrack(null);
    setCurrentTime(0);
    setDuration(0);
  }, []);

  return (
    <NowPlayingContext.Provider value={{ track, playing, currentTime, duration, toggle, close }}>
      {/* Room for the fixed-position MiniPlayer so it never overlaps page
          content — only added while something's actually loaded. */}
      <div style={track ? { paddingBottom: 76 } : undefined}>{children}</div>
      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          setDuration(Number.isFinite(d) ? Math.min(d, PREVIEW_CAP_SEC) : PREVIEW_CAP_SEC);
        }}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          setCurrentTime(Math.min(t, PREVIEW_CAP_SEC));
          if (t >= PREVIEW_CAP_SEC) {
            e.currentTarget.pause();
            if (track) logEvent(track.artistId, 'completed');
          }
        }}
        onEnded={() => {
          if (track) logEvent(track.artistId, 'completed');
        }}
        className="hidden"
      />
      {track && <MiniPlayer />}
    </NowPlayingContext.Provider>
  );
}
