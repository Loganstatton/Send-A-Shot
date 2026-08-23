'use client';
import { useMemo, useState } from 'react';
import { NextMarketRow } from '@/lib/types';
import { marketSentiment } from '@/lib/next-market';
import ArtistCard from '@/components/next/ArtistCard';

type SortMode = 'score' | 'rising' | 'new';

export default function DiscoverGrid({ rows }: { rows: NextMarketRow[] }) {
  const genres = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (!row.artist.genre) continue;
      counts.set(row.artist.genre, (counts.get(row.artist.genre) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([genre]) => genre).slice(0, 6);
  }, [rows]);

  const [genre, setGenre] = useState<string | null>(null);
  const [signalOnly, setSignalOnly] = useState(false);
  const [sort, setSort] = useState<SortMode>('score');

  const hotSignalId = useMemo(() => {
    let best: { id: number; diff: number } | null = null;
    for (const row of rows) {
      const s = marketSentiment(row.score, row.priceCents);
      if (s.tone === 'undervalued' && (!best || s.diff > best.diff)) best = { id: row.artist.id, diff: s.diff };
    }
    return best?.id ?? null;
  }, [rows]);

  const changePctFor = (row: NextMarketRow) => {
    const first = row.priceHistory[0]?.price_cents ?? row.priceCents;
    return first !== 0 ? ((row.priceCents - first) / first) * 100 : 0;
  };

  const visible = useMemo(() => {
    let list = rows;
    if (genre) list = list.filter((r) => r.artist.genre === genre);
    if (signalOnly) list = list.filter((r) => marketSentiment(r.score, r.priceCents).tone === 'undervalued');

    const sorted = [...list];
    if (sort === 'score') sorted.sort((a, b) => b.score - a.score);
    else if (sort === 'rising') sorted.sort((a, b) => changePctFor(b) - changePctFor(a));
    else if (sort === 'new') sorted.sort((a, b) => (b.artist.created_at > a.artist.created_at ? 1 : -1));
    return sorted;
  }, [rows, genre, signalOnly, sort]);

  const chip = (active: boolean) =>
    `next-pill ${active ? 'next-pill-active' : ''}`;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-2.5 flex-wrap">
        <button type="button" onClick={() => setGenre(null)} className={chip(genre === null)}>All</button>
        {genres.map((g) => (
          <button key={g} type="button" onClick={() => setGenre(g)} className={chip(genre === g)}>{g}</button>
        ))}
        <div className="w-px h-[22px] mx-1" style={{ background: 'var(--border-soft)' }} />
        <button
          type="button"
          onClick={() => setSignalOnly((v) => !v)}
          className={signalOnly ? 'next-pill next-pill-signal' : 'next-pill'}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={signalOnly ? 'var(--ember)' : 'currentColor'} strokeWidth={2.5}><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" /></svg>
          Undervalued
        </button>
        <button type="button" onClick={() => setSort((s) => (s === 'rising' ? 'score' : 'rising'))} className={chip(sort === 'rising')}>Fastest rising</button>
        <button type="button" onClick={() => setSort((s) => (s === 'new' ? 'score' : 'new'))} className={chip(sort === 'new')}>New this week</button>
      </div>

      {visible.length === 0 ? (
        <div className="next-card text-center py-16" style={{ color: 'var(--text-muted)' }}>
          No artists match these filters yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {visible.map((row) => (
            <ArtistCard key={row.artist.id} row={row} hotSignal={row.artist.id === hotSignalId} />
          ))}
        </div>
      )}
    </div>
  );
}
