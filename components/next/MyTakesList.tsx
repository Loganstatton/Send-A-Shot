'use client';
import { useState } from 'react';
import Link from 'next/link';
import { timeAgo } from '@/lib/format';

type MyTake = { id: number; body: string; artistId: number; artistName: string; createdAt: string };

// "View own posts" + "delete own post" — reachable here on your own
// profile, not just wherever the card happens to still be visible in the
// live-ranked Feed (see FeedCard's own Delete button for the other place
// this same action is available).
export default function MyTakesList({ initial }: { initial: MyTake[] }) {
  const [takes, setTakes] = useState(initial);
  const [pendingId, setPendingId] = useState<number | null>(null);

  async function remove(id: number) {
    if (!confirm('Delete this take?')) return;
    setPendingId(id);
    try {
      const res = await fetch(`/api/next/feed/posts/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('failed');
      setTakes((prev) => prev.filter((t) => t.id !== id));
    } catch {
      setPendingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      {takes.map((t) => (
        <div key={t.id} className="next-card flex items-start justify-between gap-3 px-5 py-4">
          <div className="min-w-0 flex-1">
            <Link href={`/next/artists/${t.artistId}`} className="text-sm font-semibold hover:underline">{t.artistName}</Link>
            <p className="mt-1 mb-0 text-sm" style={{ color: 'var(--text-muted)' }}>{t.body}</p>
            <p className="mt-1 mb-0 text-xs" style={{ color: 'var(--text-faint)' }}>{timeAgo(t.createdAt)}</p>
          </div>
          <button
            type="button"
            onClick={() => remove(t.id)}
            disabled={pendingId === t.id}
            className="next-btn-ghost text-xs px-3 py-1.5 rounded-lg shrink-0"
            style={{ color: 'var(--down)' }}
          >
            {pendingId === t.id ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      ))}
    </div>
  );
}
