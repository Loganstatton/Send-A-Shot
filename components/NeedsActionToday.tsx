'use client';
import { useState } from 'react';
import Link from 'next/link';
import { DueFollowUp, LOG_TYPE_LABELS } from '@/lib/types';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function FollowUpRow({ item, onDone }: { item: DueFollowUp; onDone: (item: DueFollowUp) => void }) {
  return (
    <div className="flex items-start justify-between gap-3 pt-2" style={{ borderTop: '1px solid var(--border-soft)' }}>
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Link href={`/artists/${item.artist_id}`} className="font-semibold hover:underline">{item.artist_name}</Link>
          <span className="text-xs" style={{ color: 'var(--text-faint)' }}>{LOG_TYPE_LABELS[item.type]}</span>
        </div>
        <p className="text-sm mt-1 break-words" style={{ color: 'var(--text-muted)' }}>{item.message}</p>
      </div>
      <button type="button" className="btn text-sm shrink-0" onClick={() => onDone(item)}>Mark done</button>
    </div>
  );
}

// The dashboard's "what actually needs my attention today" panel — split
// into overdue vs. due-today follow-ups (previously one undifferentiated
// list with no counts), plus new discovery candidates awaiting review,
// which is exactly as much "needs action today" as a follow-up is.
export default function NeedsActionToday({ initialFollowUps, newCandidateCount }: { initialFollowUps: DueFollowUp[]; newCandidateCount: number }) {
  const [items, setItems] = useState(initialFollowUps);

  async function handleDone(item: DueFollowUp) {
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    await fetch(`/api/artists/${item.artist_id}/log/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ follow_up_at: null }),
    });
  }

  const today = todayISO();
  const overdue = items.filter((i) => i.follow_up_at < today);
  const dueToday = items.filter((i) => i.follow_up_at === today);

  if (overdue.length === 0 && dueToday.length === 0 && newCandidateCount === 0) return null;

  return (
    <div className="card space-y-4">
      <h2 className="font-bold text-lg">✅ Needs action today</h2>

      {newCandidateCount > 0 && (
        <Link href="/discovery" className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 hover:underline" style={{ border: '1px solid var(--accent-line)', background: 'var(--accent-dim)' }}>
          <span className="text-sm">🔎 New discovery candidates awaiting review</span>
          <span className="num badge">{newCandidateCount}</span>
        </Link>
      )}

      {overdue.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--down)' }}>⚠ Overdue ({overdue.length})</h3>
          {overdue.map((item) => <FollowUpRow key={item.id} item={item} onDone={handleDone} />)}
        </div>
      )}

      {dueToday.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--fire)' }}>📅 Due today ({dueToday.length})</h3>
          {dueToday.map((item) => <FollowUpRow key={item.id} item={item} onDone={handleDone} />)}
        </div>
      )}
    </div>
  );
}
