'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DiscoveryCandidate } from '@/lib/types';
import ArtistAvatar from './ArtistAvatar';

export default function DiscoveryQueue({ initial }: { initial: DiscoveryCandidate[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function act(candidate: DiscoveryCandidate, action: 'watch' | 'pass' | 'approve') {
    setBusyId(candidate.id);
    try {
      const res = await fetch(`/api/discovery/candidates/${candidate.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Action failed');

      setItems((prev) => prev.filter((c) => c.id !== candidate.id));
      if (action === 'approve' && data.artist) {
        router.push(`/artists/${data.artist.id}`);
      }
      router.refresh();
    } catch (err: any) {
      alert(err.message ?? 'Something went wrong.');
    } finally {
      setBusyId(null);
    }
  }

  if (items.length === 0) {
    return (
      <div className="card text-center py-12">
        <p className="text-neutral-400">No new candidates right now. Run a scan, or check back after the next one.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((c) => {
        const busy = busyId === c.id;
        return (
          <div key={c.id} className="card flex items-start gap-4 flex-wrap">
            <ArtistAvatar name={c.name} photoUrl={c.photo_url} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold">{c.name}</span>
                <span className="badge text-xs">{c.source === 'youtube' ? '🎥 YouTube' : '🎵 Soundcharts'}</span>
                {c.soundcharts_uuid && c.source === 'youtube' && <span className="badge text-xs">🔗 Soundcharts matched</span>}
                {c.country && <span className="text-xs text-neutral-500">{c.country}</span>}
              </div>
              <p className="text-sm text-emerald-400 mt-1">{c.flagged_reason}</p>
              <div className="text-xs text-neutral-500 mt-1 flex gap-3 flex-wrap">
                {c.followers_count != null && <span>{c.followers_count.toLocaleString()} Spotify followers</span>}
                {c.yt_view_count != null && <span>{c.yt_view_count.toLocaleString()} YouTube views</span>}
                {c.yt_channel_subscriber_count != null && <span>{c.yt_channel_subscriber_count.toLocaleString()} subscribers</span>}
                <span>Detected {new Date(c.discovered_at).toLocaleDateString()}</span>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button type="button" className="btn text-sm" disabled={busy} onClick={() => act(c, 'pass')}>Pass</button>
              <button type="button" className="btn text-sm" disabled={busy} onClick={() => act(c, 'watch')}>Watch</button>
              <button type="button" className="btn btn-primary text-sm" disabled={busy} onClick={() => act(c, 'approve')}>
                {busy ? 'Working…' : 'Approve'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
