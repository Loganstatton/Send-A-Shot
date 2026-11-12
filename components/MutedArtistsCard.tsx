'use client';
import { useState } from 'react';

// Artists this player chose "Show less about" in the Feed, with a way back.
export default function MutedArtistsCard({ initial }: { initial: { id: number; name: string }[] }) {
  const [artists, setArtists] = useState(initial);
  if (artists.length === 0) return null;
  async function unmute(id: number) {
    const res = await fetch('/api/next/feed/mute', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artistId: id }) });
    if (res.ok) setArtists((a) => a.filter((x) => x.id !== id));
  }
  return (
    <div className="card space-y-2">
      <h2 className="font-semibold text-neutral-100">Muted in your Feed</h2>
      <p className="text-xs text-neutral-500">You chose to see less about these artists in the NEXT Feed.</p>
      <ul className="space-y-1.5">
        {artists.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-3 text-sm">
            <span>{a.name}</span>
            <button type="button" className="btn text-xs" onClick={() => unmute(a.id)} aria-label={`Unmute ${a.name}`}>Unmute</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
