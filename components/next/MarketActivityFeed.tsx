'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { MarketTrade } from '@/lib/db';
import { formatCents, timeAgo } from '@/lib/format';

type TypeFilter = 'all' | 'buy' | 'sell';

// The market-wide sibling of TransactionHistory.tsx — same Buy/Sell/All
// filter shape, but across every artist instead of one user's own history.
export default function MarketActivityFeed({ trades }: { trades: MarketTrade[] }) {
  const [type, setType] = useState<TypeFilter>('all');
  const visible = useMemo(() => trades.filter((t) => type === 'all' || t.type === type), [trades, type]);
  const chip = (active: boolean) => `next-pill ${active ? 'next-pill-active' : ''}`;

  return (
    <div className="next-card p-6 flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-display font-bold text-lg m-0">Market activity</h2>
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={() => setType('all')} className={chip(type === 'all')}>All</button>
          <button type="button" onClick={() => setType('buy')} className={chip(type === 'buy')}>Buys</button>
          <button type="button" onClick={() => setType('sell')} className={chip(type === 'sell')}>Sells</button>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="m-0 py-8 text-center text-sm" style={{ color: 'var(--text-faint)' }}>No trades match these filters.</p>
      ) : (
        <div className="flex flex-col gap-1 max-h-[480px] overflow-y-auto">
          {visible.map((t, i) => (
            <div key={i} className="flex items-center justify-between py-2.5 text-[13px]" style={{ borderTop: i > 0 ? '1px solid var(--border-soft)' : undefined }}>
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span
                  className="px-2 py-[3px] rounded-full text-[11px] font-semibold shrink-0"
                  style={t.type === 'buy' ? { background: 'var(--ember-dim)', color: 'var(--ember)' } : { background: 'var(--down-dim)', color: 'var(--down)' }}
                >
                  {t.type === 'buy' ? 'Bought' : 'Sold'}
                </span>
                <span className="truncate" style={{ color: 'var(--text-muted)' }}>{t.user_name}</span>
                <span style={{ color: 'var(--text-faint)' }}>·</span>
                <Link href={`/next/artists/${t.artist_id}`} className="truncate hover:underline font-medium">{t.artist_name}</Link>
              </div>
              <div className="flex items-center gap-2.5 shrink-0">
                <span className="num" style={{ color: 'var(--text)' }}>{formatCents(Math.abs(t.credits_delta_cents))}</span>
                <span className="text-[11.5px]" style={{ color: 'var(--text-faint)' }}>{timeAgo(t.created_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
