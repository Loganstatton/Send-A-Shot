'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { NextTransaction } from '@/lib/types';
import { formatCents } from '@/lib/format';

type Transaction = NextTransaction & { artist_name: string };
type TypeFilter = 'all' | 'buy' | 'sell';

export default function TransactionHistory({ transactions }: { transactions: Transaction[] }) {
  const [artistId, setArtistId] = useState<number | 'all'>('all');
  const [type, setType] = useState<TypeFilter>('all');

  const artists = useMemo(() => {
    const seen = new Map<number, string>();
    for (const t of transactions) seen.set(t.artist_id, t.artist_name);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [transactions]);

  const visible = useMemo(
    () => transactions.filter((t) => (artistId === 'all' || t.artist_id === artistId) && (type === 'all' || t.type === type)),
    [transactions, artistId, type]
  );

  const chip = (active: boolean) => `next-pill ${active ? 'next-pill-active' : ''}`;

  return (
    <div className="next-card p-6 flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-display font-bold text-lg m-0">Recent activity</h2>
        <div className="flex items-center gap-2.5 flex-wrap">
          <button type="button" onClick={() => setType('all')} className={chip(type === 'all')}>All</button>
          <button type="button" onClick={() => setType('buy')} className={chip(type === 'buy')}>Buys</button>
          <button type="button" onClick={() => setType('sell')} className={chip(type === 'sell')}>Sells</button>
          {artists.length > 1 && (
            <select
              value={artistId}
              onChange={(e) => setArtistId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              className="px-3 py-1.5 rounded-lg text-sm border"
              style={{ background: 'var(--surface)', borderColor: 'var(--border-soft)', color: 'var(--text)' }}
            >
              <option value="all">All artists</option>
              {artists.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="m-0 py-8 text-center text-sm" style={{ color: 'var(--text-faint)' }}>No trades match these filters.</p>
      ) : (
        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          <table className="w-full text-sm min-w-[600px]" style={{ borderCollapse: 'collapse' }}>
            <thead className="text-left">
              <tr>
                <th className="font-normal pb-2" style={{ color: 'var(--text-faint)' }}>Date</th>
                <th className="font-normal pb-2" style={{ color: 'var(--text-faint)' }}>Artist</th>
                <th className="font-normal pb-2" style={{ color: 'var(--text-faint)' }}>Type</th>
                <th className="font-normal pb-2 text-right" style={{ color: 'var(--text-faint)' }}>Shares</th>
                <th className="font-normal pb-2 text-right" style={{ color: 'var(--text-faint)' }}>Price</th>
                <th className="font-normal pb-2 text-right" style={{ color: 'var(--text-faint)' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => (
                <tr key={t.id} style={{ borderTop: '1px solid var(--border-soft)' }}>
                  <td className="py-2.5" style={{ color: 'var(--text-faint)' }}>{new Date(t.created_at).toLocaleDateString()}</td>
                  <td className="py-2.5">
                    <Link href={`/next/artists/${t.artist_id}`} className="hover:underline">{t.artist_name}</Link>
                  </td>
                  <td className="py-2.5">
                    <span
                      className="next-pill"
                      style={
                        t.type === 'buy'
                          ? { background: 'var(--up-dim)', borderColor: 'var(--up)', color: 'var(--up)', padding: '3px 10px', fontSize: 12 }
                          : { background: 'var(--down-dim)', borderColor: 'var(--down)', color: 'var(--down)', padding: '3px 10px', fontSize: 12 }
                      }
                    >
                      {t.type === 'buy' ? 'Buy' : 'Sell'}
                    </span>
                  </td>
                  <td className="num py-2.5 text-right">{t.shares.toFixed(4)}</td>
                  <td className="num py-2.5 text-right">{formatCents(t.price_cents_per_share)}</td>
                  <td className="num py-2.5 text-right">{formatCents(Math.abs(t.credits_delta_cents))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
