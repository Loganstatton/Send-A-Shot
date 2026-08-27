'use client';
import { useState } from 'react';
import Link from 'next/link';

type ReportedPost = {
  postId: number;
  body: string;
  authorName: string;
  authorEmail: string;
  authorId: number;
  artistName: string;
  reportCount: number;
  lastReportedAt: string;
  hidden: boolean;
  createdAt: string;
};

export default function FeedReportsList({ initial }: { initial: ReportedPost[] }) {
  const [posts, setPosts] = useState(initial);
  const [pendingId, setPendingId] = useState<number | null>(null);

  async function toggleHide(post: ReportedPost) {
    setPendingId(post.postId);
    try {
      const res = await fetch(`/api/admin/feed-posts/${post.postId}/hide`, { method: post.hidden ? 'DELETE' : 'POST' });
      if (!res.ok) throw new Error('request failed');
      setPosts((prev) => prev.map((p) => (p.postId === post.postId ? { ...p, hidden: !p.hidden } : p)));
    } catch {
      // Best-effort — the button just stays in its current state on failure.
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-2">
      {posts.map((p) => (
        <div
          key={p.postId}
          className="rounded-lg px-4 py-3 flex items-start justify-between gap-3 flex-wrap"
          style={{ border: p.hidden ? '1px solid var(--border)' : '1px solid var(--down)', background: p.hidden ? 'transparent' : 'oklch(64% 0.2 19 / 0.08)' }}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap text-xs" style={{ color: 'var(--text-faint)' }}>
              <span className="badge">{p.reportCount} report{p.reportCount === 1 ? '' : 's'}</span>
              {p.hidden && <span className="badge">Hidden</span>}
              <span>· about {p.artistName}</span>
              <span>· posted {new Date(p.createdAt).toLocaleString()}</span>
            </div>
            <p className="mt-1.5 mb-0 text-sm">{p.body}</p>
            <p className="mt-1.5 mb-0 text-xs" style={{ color: 'var(--text-muted)' }}>
              By <Link href={`/next/profile/${p.authorId}`} className="underline">{p.authorName}</Link> ({p.authorEmail})
            </p>
          </div>
          <button
            type="button"
            onClick={() => toggleHide(p)}
            disabled={pendingId === p.postId}
            className="btn text-sm shrink-0"
          >
            {pendingId === p.postId ? 'Working…' : p.hidden ? 'Unhide' : 'Hide'}
          </button>
        </div>
      ))}
    </div>
  );
}
