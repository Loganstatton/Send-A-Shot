'use client';
import { useState } from 'react';
import { track } from '@/lib/track';

// Deezer's 30s-mp3 preview replacement. Deliberately NOT an <audio src>
// swap onto a YouTube URL — YouTube doesn't serve a direct audio file, and
// extracting/proxying one would violate the no-download/no-extraction/
// no-hidden-audio rules this migration is built around. Instead this opens
// a real, official, visible youtube-nocookie.com embed in a small overlay,
// click-to-play only (never autoplay on load/hover) — same compliance
// shape as VideoBanner.tsx's hero player, just usable from a compact card
// context that doesn't have room for VideoBanner's full-size treatment.
export default function YouTubePreviewButton({
  artistId,
  artistName,
  videoId,
  variant = 'default',
}: {
  artistId: number;
  artistName: string;
  videoId?: string;
  variant?: 'default' | 'icon';
}) {
  const [open, setOpen] = useState(false);
  const available = Boolean(videoId);
  const unavailableLabel = 'No music preview available yet';

  function handleOpen(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!available) return;
    setOpen(true);
    track('video_played', { artistId });
    // Best-effort — mirrors the old AudioPreview's 'started' beacon so
    // "listened before buy" trade attribution still has a real signal to
    // read (see hasListenedToArtist in lib/db.ts). No 'completed' beacon
    // here: an embedded iframe doesn't expose playback-finished without
    // wiring YouTube's IFrame Player API, which isn't worth the added
    // surface just for that one secondary metric.
    fetch('/api/next/preview-listen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artistId, event: 'started' }),
    }).catch(() => {});
  }

  const button =
    variant === 'icon' ? (
      <button
        type="button"
        onClick={handleOpen}
        disabled={!available}
        aria-label={!available ? unavailableLabel : `Watch ${artistName.split(' ')[0]}'s video`}
        title={!available ? unavailableLabel : undefined}
        className="next-icon-btn w-[34px] h-[34px] rounded-full flex items-center justify-center shrink-0 border active:scale-90 disabled:active:scale-100 disabled:cursor-default"
        style={{ background: 'var(--surface-2)', borderColor: 'var(--border-soft)', opacity: available ? 1 : 0.4 }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="var(--text)"><path d="M6 4 20 12 6 20Z" /></svg>
      </button>
    ) : (
      <button
        type="button"
        onClick={handleOpen}
        disabled={!available}
        title={!available ? unavailableLabel : undefined}
        className={`btn text-sm ${!available ? 'opacity-40 cursor-default' : ''}`}
      >
        {available ? `▶ Watch ${artistName.split(' ')[0]}` : unavailableLabel}
      </button>
    );

  return (
    <>
      {button}
      {open && videoId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-5"
          style={{ background: 'oklch(8% 0.01 40 / 0.86)', backdropFilter: 'blur(4px)' }}
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label={`${artistName} — video preview`}
        >
          <div
            className="relative w-full max-w-[720px] rounded-2xl overflow-hidden next-card"
            style={{ aspectRatio: '16 / 9' }}
            onClick={(e) => e.stopPropagation()}
          >
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1`}
              title={`${artistName} — video preview`}
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 w-full h-full border-0"
            />
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close preview"
              className="absolute top-3 right-3 w-9 h-9 rounded-full flex items-center justify-center border"
              style={{ background: 'oklch(10% 0.01 40 / 0.8)', borderColor: 'var(--border-soft)', color: 'var(--text)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
