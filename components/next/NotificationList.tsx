'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Notification, NotificationCategory } from '@/lib/notifications';
import { timeAgo } from '@/lib/format';

const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  watchlist_moves: 'Watchlist',
  new_artists: 'New artist',
  founding_believer: 'Founding Believer',
  portfolio_milestones: 'Portfolio',
  leaderboard_rank: 'Leaderboard',
};

export default function NotificationList({ notifications }: { notifications: Notification[] }) {
  const [items, setItems] = useState(notifications);
  const [markingAll, setMarkingAll] = useState(false);
  const unreadCount = items.filter((n) => !n.read).length;

  async function markRead(key: string) {
    setItems((prev) => prev.map((n) => (n.key === key ? { ...n, read: true } : n)));
    try {
      await fetch('/api/next/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
    } catch {
      // Best-effort — a failed dismiss just means it reappears as unread next visit, not a broken page.
    }
  }

  async function markAllRead() {
    const unreadKeys = items.filter((n) => !n.read).map((n) => n.key);
    if (unreadKeys.length === 0) return;
    setMarkingAll(true);
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await fetch('/api/next/notifications/read-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: unreadKeys }),
      });
    } catch {
      // Same as markRead — worst case they reappear next visit.
    } finally {
      setMarkingAll(false);
    }
  }

  if (items.length === 0) {
    return (
      <div className="next-card text-center py-16" style={{ color: 'var(--text-muted)' }}>
        <p className="m-0">Nothing to report right now.</p>
        <p className="mt-1.5 mb-0 text-sm" style={{ color: 'var(--text-faint)' }}>
          Watch some artists and back a few — we&apos;ll let you know when something moves.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-sm" style={{ color: 'var(--text-faint)' }}>
          {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
        </span>
        {unreadCount > 0 && (
          <button type="button" onClick={markAllRead} disabled={markingAll} className="next-btn-ghost text-xs px-3 py-1.5 rounded-lg">
            Mark all read
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {items.map((n) => (
          <div
            key={n.key}
            className="next-card flex items-start justify-between gap-3 px-5 py-4"
            style={n.read ? undefined : { borderColor: 'var(--ember-line)', background: 'var(--ember-dim)' }}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[11px] font-mono uppercase tracking-[0.04em]" style={{ color: n.read ? 'var(--text-faint)' : 'var(--ember)' }}>
                  {CATEGORY_LABELS[n.category]}
                </span>
                <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>{timeAgo(n.occurredAt)}</span>
              </div>
              <p className="m-0 text-sm" style={{ color: n.read ? 'var(--text-muted)' : 'var(--text)' }}>
                {n.artistId ? (
                  <Link href={`/next/artists/${n.artistId}`} className="hover:underline">{n.message}</Link>
                ) : (
                  n.message
                )}
              </p>
            </div>
            {!n.read && (
              <button
                type="button"
                onClick={() => markRead(n.key)}
                className="next-icon-btn shrink-0 text-xs px-2.5 py-1 rounded-lg border"
                style={{ borderColor: 'var(--border-soft)', color: 'var(--text-faint)' }}
              >
                Dismiss
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
