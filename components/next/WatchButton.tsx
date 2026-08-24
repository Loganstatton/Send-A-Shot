'use client';
import { useState } from 'react';

// A bookmark, not a purchase — lets a user track an artist with zero
// credits spent. Optimistic toggle against /api/next/artists/[id]/watchlist,
// reverting on failure.
export default function WatchButton({
  artistId,
  initialWatching,
  variant = 'icon',
}: {
  artistId: number;
  initialWatching: boolean;
  variant?: 'icon' | 'labeled';
}) {
  const [watching, setWatching] = useState(initialWatching);
  const [pending, setPending] = useState(false);

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;
    const next = !watching;
    setPending(true);
    setWatching(next);
    try {
      const res = await fetch(`/api/next/artists/${artistId}/watchlist`, { method: next ? 'POST' : 'DELETE' });
      if (!res.ok) throw new Error('request failed');
    } catch {
      setWatching(!next);
    } finally {
      setPending(false);
    }
  }

  const icon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill={watching ? 'var(--ember)' : 'none'} stroke={watching ? 'var(--ember)' : 'currentColor'} strokeWidth={2}>
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z" />
    </svg>
  );

  if (variant === 'labeled') {
    return (
      <button
        type="button"
        onClick={toggle}
        className="next-icon-btn flex items-center gap-1.5 px-3 py-2.5 rounded-lg border text-[12.5px] font-medium active:scale-95"
        style={{
          borderColor: watching ? 'var(--ember-line)' : 'var(--border-soft)',
          color: watching ? 'var(--ember)' : 'var(--text-muted)',
          background: watching ? 'var(--ember-dim)' : 'transparent',
        }}
      >
        {icon}
        {watching ? 'Watching' : 'Watch'}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={watching ? 'Remove from watchlist' : 'Add to watchlist'}
      className="next-icon-btn w-8 h-8 rounded-full flex items-center justify-center border shrink-0 active:scale-90"
      style={{ background: 'oklch(15% 0.012 40 / 0.72)', borderColor: watching ? 'var(--ember-line)' : 'var(--border-soft)', backdropFilter: 'blur(6px)' }}
    >
      {icon}
    </button>
  );
}
