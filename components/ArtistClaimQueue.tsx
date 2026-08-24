'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArtistClaim } from '@/lib/types';

export default function ArtistClaimQueue({ initial }: { initial: ArtistClaim[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function review(claim: ArtistClaim, decision: 'approved' | 'rejected') {
    setBusyId(claim.id);
    try {
      const res = await fetch(`/api/artist-claims/${claim.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Action failed');
      setItems((prev) => prev.filter((c) => c.id !== claim.id));
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
        <p style={{ color: 'var(--text-muted)' }}>No pending claims right now.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((claim) => {
        const busy = busyId === claim.id;
        return (
          <div key={claim.id} className="card flex items-start gap-4 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Link href={`/artists/${claim.artist_id}`} className="font-semibold" style={{ color: 'var(--text)' }}>
                  {claim.artist_name}
                </Link>
                <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                  claimed by {claim.user_name} ({claim.user_email})
                </span>
              </div>
              {claim.message && <p className="text-sm mt-1" style={{ color: 'var(--accent)' }}>{claim.message}</p>}
              <p className="num text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
                Submitted {new Date(claim.created_at).toLocaleString()}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button type="button" className="btn text-sm" disabled={busy} onClick={() => review(claim, 'rejected')}>Reject</button>
              <button type="button" className="btn btn-primary text-sm" disabled={busy} onClick={() => review(claim, 'approved')}>
                {busy ? 'Working…' : 'Approve'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
