'use client';
import { useState } from 'react';
import { ReactionType } from '@/lib/types';
import { track } from '@/lib/track';

// Lightweight only, per the spec: 🔥, 👀, and an "EARLY" text badge — one
// reaction per user per post, tap again to remove or change. No comments,
// no replies, no reaction-on-a-reaction; that's the whole surface.
const REACTIONS: { type: ReactionType; render: React.ReactNode; label: string }[] = [
  { type: 'fire', render: '🔥', label: 'Fire' },
  { type: 'eyes', render: '👀', label: 'Watching this closely' },
  { type: 'early', render: <span className="font-mono font-bold text-[9px] tracking-[0.04em]">EARLY</span>, label: 'Called it early' },
];

export default function ReactionBar({
  feedEventId,
  initialCounts,
  initialViewerReaction,
}: {
  feedEventId: number;
  initialCounts: Record<ReactionType, number>;
  initialViewerReaction: ReactionType | null;
}) {
  const [counts, setCounts] = useState(initialCounts);
  const [viewerReaction, setViewerReaction] = useState(initialViewerReaction);
  const [pending, setPending] = useState(false);

  async function tap(type: ReactionType) {
    if (pending) return;
    setPending(true);
    const prevCounts = counts;
    const prevReaction = viewerReaction;
    const removing = prevReaction === type;

    // Optimistic — same pattern as WatchButton, revert on failure.
    const optimistic = { ...counts };
    if (prevReaction) optimistic[prevReaction] = Math.max(0, optimistic[prevReaction] - 1);
    if (!removing) optimistic[type] = optimistic[type] + 1;
    setCounts(optimistic);
    setViewerReaction(removing ? null : type);

    try {
      const res = await fetch(`/api/next/feed/${feedEventId}/reaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reactionType: type }),
      });
      if (!res.ok) throw new Error('request failed');
      const data = await res.json();
      setCounts(data.counts);
      setViewerReaction(data.reaction);
      if (!removing) track('feed_reaction_added', { feedEventId, reactionType: type });
    } catch {
      setCounts(prevCounts);
      setViewerReaction(prevReaction);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      {REACTIONS.map((r) => {
        const active = viewerReaction === r.type;
        const count = counts[r.type];
        return (
          <button
            key={r.type}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              tap(r.type);
            }}
            aria-label={r.label}
            aria-pressed={active}
            disabled={pending}
            className="flex items-center gap-1 px-2 py-1 rounded-full border text-[12px] active:scale-90 disabled:cursor-default"
            style={{
              borderColor: active ? 'var(--ember-line)' : 'var(--border-soft)',
              color: active ? 'var(--ember)' : 'var(--text-muted)',
              background: active ? 'var(--ember-dim)' : 'transparent',
            }}
          >
            {r.render}
            {count > 0 && <span className="num">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
