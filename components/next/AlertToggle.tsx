'use client';
import { useState } from 'react';

// Per-watch preference: whether the Watchlist should flag this artist when
// its Score or Price moves significantly since it was added (see the
// "since you added" line on ArtistCard). Optimistic toggle against
// PATCH /api/next/artists/[id]/watchlist, reverting on failure — same
// shape as WatchButton.tsx.
export default function AlertToggle({
  artistId,
  initialEnabled,
}: {
  artistId: number;
  initialEnabled: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, setPending] = useState(false);

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;
    const next = !enabled;
    setPending(true);
    setEnabled(next);
    try {
      const res = await fetch(`/api/next/artists/${artistId}/watchlist`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertsEnabled: next }),
      });
      if (!res.ok) throw new Error('request failed');
    } catch {
      setEnabled(!next);
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={enabled ? 'Turn off move alerts for this artist' : 'Turn on move alerts for this artist'}
      title={enabled ? 'Alerts on — flags big Score/Price moves' : 'Alerts off'}
      className="next-icon-btn w-7 h-7 rounded-full flex items-center justify-center border shrink-0 active:scale-90"
      style={{
        borderColor: enabled ? 'var(--ember-line)' : 'var(--border-soft)',
        background: enabled ? 'var(--ember-dim)' : 'transparent',
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill={enabled ? 'var(--ember)' : 'none'} stroke={enabled ? 'var(--ember)' : 'var(--text-faint)'} strokeWidth={2}>
        <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
