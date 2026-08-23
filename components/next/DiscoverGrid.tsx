'use client';
import { useMemo, useState } from 'react';
import { NextMarketRow, ScoreChange } from '@/lib/types';
import { marketSentiment } from '@/lib/next-market';
import ArtistCard, { SinceWatched } from '@/components/next/ArtistCard';

type SortMode = 'score' | 'growth' | 'gain' | 'loss' | 'new' | 'smallest' | 'gap' | 'watched' | 'backed' | 'trending' | 'momentum';

const SORT_LABELS: Record<SortMode, string> = {
  score: 'NEXT Score',
  growth: 'Fastest growth',
  gain: 'Biggest price gain',
  loss: 'Biggest price loss',
  new: 'Newest artist',
  smallest: 'Smallest audience',
  gap: 'Biggest Score-vs-Price gap',
  watched: 'Most watched',
  backed: 'Most backed',
  trending: 'Trending today',
  // "Momentum" and "NEXT Score change" are the same underlying number in
  // this codebase — see momentumStatus() in lib/scoring.ts and its use in
  // the internal Screener, where "momentum" already means exactly this:
  // Breakout Score change since the previous snapshot.
  momentum: 'Momentum (Score change)',
};
const SORT_MODES = Object.keys(SORT_LABELS) as SortMode[];

// A window used only for the "Trending today" sort — same idea as
// PriceChart's own 1D range, just inlined here since sorting needs a
// single number per artist rather than a chart's full filtered series.
function changePctForWindow(row: NextMarketRow, hours: number): number {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const inWindow = row.priceHistory.filter((p) => new Date(p.recorded_at).getTime() >= cutoff);
  const first = inWindow[0]?.price_cents ?? row.priceHistory[0]?.price_cents ?? row.priceCents;
  return first !== 0 ? ((row.priceCents - first) / first) * 100 : 0;
}

function changePctFor(row: NextMarketRow): number {
  const first = row.priceHistory[0]?.price_cents ?? row.priceCents;
  return first !== 0 ? ((row.priceCents - first) / first) * 100 : 0;
}

type RangeFilter = { min: string; max: string };
const EMPTY_RANGE: RangeFilter = { min: '', max: '' };

function inRange(value: number | null | undefined, range: RangeFilter): boolean {
  if (value == null) return range.min === '' && range.max === '';
  if (range.min !== '' && value < Number(range.min)) return false;
  if (range.max !== '' && value > Number(range.max)) return false;
  return true;
}

export default function DiscoverGrid({
  rows,
  watchedIds = [],
  watchCounts = {},
  backerCounts = {},
  scoreChanges = {},
  sinceWatchedByArtist = {},
  emptyMessage = 'No artists match these filters yet.',
}: {
  rows: NextMarketRow[];
  watchedIds?: number[];
  watchCounts?: Record<number, number>;
  backerCounts?: Record<number, number>;
  scoreChanges?: Record<number, ScoreChange>;
  // Watchlist-only: when this artist was added and what Score/Price looked
  // like then, keyed by artist id. Undefined/empty on Discover, where
  // "since you added" doesn't apply.
  sinceWatchedByArtist?: Record<number, SinceWatched>;
  emptyMessage?: string;
}) {
  const watchedSet = useMemo(() => new Set(watchedIds), [watchedIds]);
  const genres = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (!row.artist.genre) continue;
      counts.set(row.artist.genre, (counts.get(row.artist.genre) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([genre]) => genre).slice(0, 6);
  }, [rows]);

  // "Small audience, strong fundamentals" — small is relative to today's
  // roster (below the median follower count among artists that actually
  // report one), strong is a flat Score bar high enough to mean something
  // regardless of roster size. Artists with no follower count at all are
  // left out rather than assumed small — an unknown isn't a gem.
  const followerMedian = useMemo(() => {
    const counts = rows.map((r) => r.artist.followers_count).filter((v): v is number => v != null).sort((a, b) => a - b);
    return counts.length ? counts[Math.floor(counts.length / 2)] : null;
  }, [rows]);
  const HIDDEN_GEM_MIN_SCORE = 65;

  const [genre, setGenre] = useState<string | null>(null);
  const [signalOnly, setSignalOnly] = useState(false);
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [hiddenGemsOnly, setHiddenGemsOnly] = useState(false);
  const [sort, setSort] = useState<SortMode>('score');
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [followerRange, setFollowerRange] = useState<RangeFilter>(EMPTY_RANGE);
  const [scoreRange, setScoreRange] = useState<RangeFilter>(EMPTY_RANGE);
  const [priceRange, setPriceRange] = useState<RangeFilter>(EMPTY_RANGE);

  const activeRangeCount = [followerRange, scoreRange, priceRange].filter((r) => r.min !== '' || r.max !== '').length;

  const hotSignalId = useMemo(() => {
    let best: { id: number; diff: number } | null = null;
    for (const row of rows) {
      const s = marketSentiment(row.score, row.priceCents);
      if (s.tone === 'undervalued' && (!best || s.diff > best.diff)) best = { id: row.artist.id, diff: s.diff };
    }
    return best?.id ?? null;
  }, [rows]);

  const visible = useMemo(() => {
    let list = rows;
    const term = search.trim().toLowerCase();
    if (term) list = list.filter((r) => r.artist.name.toLowerCase().includes(term));
    if (genre) list = list.filter((r) => r.artist.genre === genre);
    if (signalOnly) list = list.filter((r) => marketSentiment(r.score, r.priceCents).tone === 'undervalued');
    if (watchlistOnly) list = list.filter((r) => watchedSet.has(r.artist.id));
    if (hiddenGemsOnly) {
      list = list.filter((r) => r.artist.followers_count != null && followerMedian != null && r.artist.followers_count <= followerMedian && r.score >= HIDDEN_GEM_MIN_SCORE);
    }
    if (followerRange.min !== '' || followerRange.max !== '') list = list.filter((r) => inRange(r.artist.followers_count, followerRange));
    if (scoreRange.min !== '' || scoreRange.max !== '') list = list.filter((r) => inRange(r.score, scoreRange));
    if (priceRange.min !== '' || priceRange.max !== '') list = list.filter((r) => inRange(r.priceCents / 100, priceRange));

    const sorted = [...list];
    switch (sort) {
      case 'score': sorted.sort((a, b) => b.score - a.score); break;
      case 'growth': sorted.sort((a, b) => (b.artist.growth_velocity_pct ?? -Infinity) - (a.artist.growth_velocity_pct ?? -Infinity)); break;
      case 'gain': sorted.sort((a, b) => changePctFor(b) - changePctFor(a)); break;
      case 'loss': sorted.sort((a, b) => changePctFor(a) - changePctFor(b)); break;
      case 'new': sorted.sort((a, b) => (b.artist.created_at > a.artist.created_at ? 1 : -1)); break;
      case 'smallest': sorted.sort((a, b) => (a.artist.followers_count ?? Infinity) - (b.artist.followers_count ?? Infinity)); break;
      case 'gap': sorted.sort((a, b) => Math.abs(marketSentiment(b.score, b.priceCents).diff) - Math.abs(marketSentiment(a.score, a.priceCents).diff)); break;
      case 'watched': sorted.sort((a, b) => (watchCounts[b.artist.id] ?? 0) - (watchCounts[a.artist.id] ?? 0)); break;
      case 'backed': sorted.sort((a, b) => (backerCounts[b.artist.id] ?? 0) - (backerCounts[a.artist.id] ?? 0)); break;
      case 'trending': sorted.sort((a, b) => changePctForWindow(b, 24) - changePctForWindow(a, 24)); break;
      case 'momentum': sorted.sort((a, b) => (scoreChanges[b.artist.id]?.changeAbs ?? -Infinity) - (scoreChanges[a.artist.id]?.changeAbs ?? -Infinity)); break;
    }
    return sorted;
  }, [rows, genre, signalOnly, watchlistOnly, hiddenGemsOnly, followerMedian, followerRange, scoreRange, priceRange, sort, search, watchedSet, watchCounts, backerCounts, scoreChanges]);

  const chip = (active: boolean) => `next-pill ${active ? 'next-pill-active' : ''}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-[360px]">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search artists…"
            className="w-full pl-9 pr-3 py-2 rounded-lg text-sm border"
            style={{ background: 'var(--surface)', borderColor: 'var(--border-soft)', color: 'var(--text)' }}
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortMode)}
          className="px-3 py-2 rounded-lg text-sm border"
          style={{ background: 'var(--surface)', borderColor: 'var(--border-soft)', color: 'var(--text)' }}
        >
          {SORT_MODES.map((m) => <option key={m} value={m}>{SORT_LABELS[m]}</option>)}
        </select>
      </div>

      <div className="flex items-center gap-2.5 flex-wrap">
        <button type="button" onClick={() => setGenre(null)} className={chip(genre === null)}>All</button>
        {genres.map((g) => (
          <button key={g} type="button" onClick={() => setGenre(g)} className={chip(genre === g)}>{g}</button>
        ))}
        <div className="hidden sm:block w-px h-[22px] mx-1" style={{ background: 'var(--border-soft)' }} />
        <button type="button" onClick={() => setSignalOnly((v) => !v)} className={signalOnly ? 'next-pill next-pill-signal' : 'next-pill'}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={signalOnly ? 'var(--ember)' : 'currentColor'} strokeWidth={2.5}><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" /></svg>
          Undervalued
        </button>
        <button type="button" onClick={() => setWatchlistOnly((v) => !v)} className={chip(watchlistOnly)}>Watchlisted</button>
        <button type="button" onClick={() => setHiddenGemsOnly((v) => !v)} className={chip(hiddenGemsOnly)}>Hidden gems</button>
        <button type="button" onClick={() => setFiltersOpen((v) => !v)} className={chip(filtersOpen || activeRangeCount > 0)}>
          Filters{activeRangeCount > 0 ? ` (${activeRangeCount})` : ''}
        </button>
      </div>

      {filtersOpen && (
        <div className="next-card p-5 grid grid-cols-1 sm:grid-cols-3 gap-5">
          <RangeInput label="Followers" range={followerRange} onChange={setFollowerRange} />
          <RangeInput label="NEXT Score" range={scoreRange} onChange={setScoreRange} max={100} />
          <RangeInput label="Price ($)" range={priceRange} onChange={setPriceRange} />
        </div>
      )}

      {visible.length === 0 ? (
        <div className="next-card text-center py-16" style={{ color: 'var(--text-muted)' }}>
          {emptyMessage}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {visible.map((row) => (
            <ArtistCard
              key={row.artist.id}
              row={row}
              hotSignal={row.artist.id === hotSignalId}
              watching={watchedSet.has(row.artist.id)}
              sinceWatched={sinceWatchedByArtist[row.artist.id]}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RangeInput({
  label, range, onChange, max,
}: {
  label: string;
  range: RangeFilter;
  onChange: (r: RangeFilter) => void;
  max?: number;
}) {
  return (
    <div>
      <div className="text-xs font-mono mb-1.5" style={{ color: 'var(--text-faint)' }}>{label}</div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          max={max}
          value={range.min}
          onChange={(e) => onChange({ ...range, min: e.target.value })}
          placeholder="Min"
          className="w-full px-2.5 py-1.5 rounded-lg text-sm border"
          style={{ background: 'var(--surface-2)', borderColor: 'var(--border-soft)', color: 'var(--text)' }}
        />
        <span style={{ color: 'var(--text-faint)' }}>–</span>
        <input
          type="number"
          min={0}
          max={max}
          value={range.max}
          onChange={(e) => onChange({ ...range, max: e.target.value })}
          placeholder="Max"
          className="w-full px-2.5 py-1.5 rounded-lg text-sm border"
          style={{ background: 'var(--surface-2)', borderColor: 'var(--border-soft)', color: 'var(--text)' }}
        />
      </div>
    </div>
  );
}
