'use client';
import { useNowPlaying } from '@/components/next/NowPlayingProvider';

function formatTime(sec: number): string {
  return `0:${String(Math.max(0, Math.floor(sec))).padStart(2, '0')}`;
}

// Renders only while something is loaded (see NowPlayingProvider:
// {track && <MiniPlayer />}) — appears the moment a preview starts and
// stays through pause, so a paused track can be resumed, and disappears
// only on the explicit close (X) or by starting elsewhere and closing.
export default function MiniPlayer() {
  const { track, playing, currentTime, duration, toggle, close } = useNowPlaying();
  if (!track) return null;

  const remaining = Math.max(0, duration - currentTime);
  const progressPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 border-t"
      style={{ background: 'oklch(12% 0.012 40 / 0.94)', borderColor: 'var(--border-soft)', backdropFilter: 'blur(10px)' }}
    >
      <div className="relative h-[2px]" style={{ background: 'var(--surface-2)' }}>
        <div className="absolute inset-y-0 left-0" style={{ width: `${progressPct}%`, background: 'var(--ember)' }} />
      </div>
      <div className="max-w-[1280px] mx-auto px-5 sm:px-8 md:px-12 py-3 flex items-center gap-3.5">
        <button
          type="button"
          onClick={() => toggle(track)}
          aria-label={playing ? 'Pause preview' : 'Play preview'}
          className="next-icon-btn w-10 h-10 rounded-full flex items-center justify-center shrink-0 border active:scale-90"
          style={{ background: 'var(--surface-2)', borderColor: 'var(--border-soft)' }}
        >
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--text)"><rect x="5" y="4" width="5" height="16" /><rect x="14" y="4" width="5" height="16" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--text)"><path d="M6 4 20 12 6 20Z" /></svg>
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="font-display font-bold text-[14px] truncate">{track.artistName}</div>
          <div className="text-[11px]" style={{ color: 'var(--text-faint)' }}>Preview</div>
        </div>

        <div className="num text-[11.5px] shrink-0 hidden sm:block" style={{ color: 'var(--text-faint)' }}>
          {formatTime(currentTime)} <span style={{ opacity: 0.5 }}>/</span> -{formatTime(remaining)}
        </div>

        <button
          type="button"
          onClick={close}
          aria-label="Close player"
          className="next-icon-btn w-8 h-8 rounded-full flex items-center justify-center shrink-0"
          style={{ color: 'var(--text-faint)' }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
    </div>
  );
}
