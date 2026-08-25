'use client';
import { useState } from 'react';

// Distinct from ShareReceiptButton — that hands the PNG to the OS share
// sheet (Messages, X, outside NEXT entirely). This posts the collectible
// into NEXT's own Feed as a founding_believer_share event. The Feed's own
// UI (a later PR) is what actually renders these; for now this just
// proves the action end-to-end — click it, the event exists in
// feed_events, confirmed by the response.
export default function ShareToFeedButton({ artistId }: { artistId: number }) {
  const [state, setState] = useState<'idle' | 'sharing' | 'shared' | 'already' | 'error'>('idle');

  async function share() {
    setState('sharing');
    try {
      const res = await fetch(`/api/next/artists/${artistId}/founding-believer-share`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not share');
      setState(data.shared ? 'shared' : 'already');
    } catch {
      setState('error');
    }
  }

  const label = {
    idle: 'Share to Feed',
    sharing: 'Sharing…',
    shared: '✓ Shared to Feed',
    already: 'Already shared today',
    error: 'Could not share — try again',
  }[state];

  return (
    <button
      type="button"
      onClick={share}
      disabled={state === 'sharing' || state === 'shared'}
      className="next-btn-ghost text-sm px-4 py-2.5 rounded-[10px]"
    >
      {label}
    </button>
  );
}
