'use client';
import { useState } from 'react';
import Link from 'next/link';
import { DueFollowUp, LOG_TYPE_LABELS } from '@/lib/types';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function FollowUpList({ initial }: { initial: DueFollowUp[] }) {
  const [items, setItems] = useState(initial);

  async function handleDone(item: DueFollowUp) {
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    await fetch(`/api/artists/${item.artist_id}/log/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ follow_up_at: null }),
    });
  }

  if (items.length === 0) return null;

  return (
    <div className="card space-y-3">
      <h2 className="font-semibold text-lg">📅 Due for follow-up</h2>
      <div className="space-y-2">
        {items.map((item) => {
          const overdue = item.follow_up_at < todayISO();
          return (
            <div key={item.id} className="flex items-start justify-between gap-3 border-t border-neutral-800 pt-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link href={`/artists/${item.artist_id}`} className="font-semibold hover:underline">
                    {item.artist_name}
                  </Link>
                  <span className={`badge ${overdue ? 'bg-red-500/20 border-red-500/40 text-red-300' : 'bg-amber-500/20 border-amber-500/40 text-amber-300'}`}>
                    {overdue ? 'Overdue' : 'Due'} {item.follow_up_at}
                  </span>
                  <span className="text-xs text-neutral-500">{LOG_TYPE_LABELS[item.type]}</span>
                </div>
                <p className="text-sm text-neutral-300 mt-1 break-words">{item.message}</p>
              </div>
              <button type="button" className="btn text-sm shrink-0" onClick={() => handleDone(item)}>
                Mark done
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
