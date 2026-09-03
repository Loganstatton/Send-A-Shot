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
        <p style={{ color: 'var(--text-muted)' }}>No new candidates right now. Run a scan, or check back after the next one.</p>
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
                <span className="badge text-xs">
                  {c.source === 'youtube' ? '🎥 YouTube' : c.source === 'public_submission' ? '🙋 Fan submission' : '🎵 Soundcharts'}
                </span>
                {c.soundcharts_uuid && c.source === 'youtube' && <span className="badge text-xs">🔗 Soundcharts matched</span>}
                {c.country && <span className="text-xs" style={{ color: 'var(--text-faint)' }}>{c.country}</span>}
              </div>
              {c.source === 'public_submission' && (
                <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
                  Submitted by {c.submitted_by_name ?? 'a NEXT user'}
                  {c.submission_url && (
                    <>
                      {' · '}
                      <a href={c.submission_url} target="_blank" rel="noreferrer" className="underline">{c.submission_url}</a>
                    </>
                  )}
                </p>
              )}
              <p className="text-sm mt-1" style={{ color: 'var(--accent)' }}>{c.flagged_reason}</p>
              {c.yt_example_comment_2 && (
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  💬 &ldquo;{c.yt_example_comment_2}&rdquo; ({c.yt_example_comment_2_likes ?? 0} like{c.yt_example_comment_2_likes === 1 ? '' : 's'})
                </p>
              )}
              <div className="num text-xs mt-1 flex gap-3 flex-wrap" style={{ color: 'var(--text-faint)' }}>
                {c.followers_count != null && <span>{c.followers_count.toLocaleString()} Spotify followers</span>}
                {c.yt_view_count != null && <span>{c.yt_view_count.toLocaleString()} YouTube views</span>}
                {c.yt_channel_subscriber_count != null && <span>{c.yt_channel_subscriber_count.toLocaleString()} subscribers</span>}
                {c.yt_hype_comment_rate != null && (
                  <span>{Math.round(c.yt_hype_comment_rate * 1000) / 10}% hype comments{c.yt_comments_analyzed != null ? ` (of ${c.yt_comments_analyzed})` : ''}</span>
                )}
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
