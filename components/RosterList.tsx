'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Artist, Stage, STAGE_LABELS, STAGES } from '@/lib/types';
import ScoreBadge from './ScoreBadge';

export type RosterArtist = Artist & { score: number; last_activity_at?: string };

type SortKey = 'score' | 'growth' | 'activity' | 'name';

const SORT_LABELS: Record<SortKey, string> = {
  score: 'Breakout Score',
  growth: 'Growth %',
  activity: 'Most recent activity',
  name: 'Name',
};

// Client-side filtering/sorting over the whole roster, already loaded into
// memory by the dashboard — this app's scale (a Scout's own tracked
// artists, not a public catalog) makes that simpler and just as fast as a
// server round trip per filter change, and needs no new DB queries at all
// for search/stage/scout/genre/score/growth (scout_name and genre are
// free text, not enums, so their filter options are just the distinct
// values already present in this same array).
export default function RosterList({ artists }: { artists: RosterArtist[] }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState<Stage | 'active' | 'all'>('active');
  const [scout, setScout] = useState('all');
  const [genre, setGenre] = useState('all');
  const [minScore, setMinScore] = useState('');
  const [minGrowth, setMinGrowth] = useState('');
  const [sort, setSort] = useState<SortKey>('score');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkStage, setBulkStage] = useState<Stage>('contacted');
  const [applying, setApplying] = useState(false);

  const scouts = useMemo(() => Array.from(new Set(artists.map((a) => a.scout_name).filter((s): s is string => Boolean(s)))).sort(), [artists]);
  const genres = useMemo(() => Array.from(new Set(artists.map((a) => a.genre).filter((g): g is string => Boolean(g)))).sort(), [artists]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const minScoreNum = minScore === '' ? null : Number(minScore);
    const minGrowthNum = minGrowth === '' ? null : Number(minGrowth);
    const list = artists.filter((a) => {
      if (stage === 'active' && a.stage === 'passed') return false;
      if (stage !== 'all' && stage !== 'active' && a.stage !== stage) return false;
      if (scout !== 'all' && a.scout_name !== scout) return false;
      if (genre !== 'all' && a.genre !== genre) return false;
      if (term && !a.name.toLowerCase().includes(term)) return false;
      if (minScoreNum != null && a.score < minScoreNum) return false;
      if (minGrowthNum != null && (a.growth_velocity_pct ?? -Infinity) < minGrowthNum) return false;
      return true;
    });
    return list.sort((a, b) => {
      if (sort === 'score') return b.score - a.score;
      if (sort === 'growth') return (b.growth_velocity_pct ?? -Infinity) - (a.growth_velocity_pct ?? -Infinity);
      if (sort === 'activity') return (b.last_activity_at ?? '').localeCompare(a.last_activity_at ?? '');
      return a.name.localeCompare(b.name);
    });
  }, [artists, search, stage, scout, genre, minScore, minGrowth, sort]);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function applyBulkStage() {
    setApplying(true);
    try {
      const res = await fetch('/api/artists/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selected], stage: bulkStage }),
      });
      if (!res.ok) throw new Error('Bulk update failed');
      setSelected(new Set());
      router.refresh();
    } catch {
      alert('Something went wrong applying the bulk stage change.');
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap gap-3 items-end">
        <div>
          <label className="label">Search</label>
          <input className="input" placeholder="Artist name…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div>
          <label className="label">Stage</label>
          <select className="input" value={stage} onChange={(e) => setStage(e.target.value as Stage | 'active' | 'all')}>
            <option value="active">Active (not passed)</option>
            <option value="all">All stages</option>
            {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Scout</label>
          <select className="input" value={scout} onChange={(e) => setScout(e.target.value)}>
            <option value="all">All scouts</option>
            {scouts.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Genre</label>
          <select className="input" value={genre} onChange={(e) => setGenre(e.target.value)}>
            <option value="all">All genres</option>
            {genres.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Min score</label>
          <input type="number" min={0} max={100} className="input w-24" value={minScore} onChange={(e) => setMinScore(e.target.value)} />
        </div>
        <div>
          <label className="label">Min growth %</label>
          <input type="number" className="input w-24" value={minGrowth} onChange={(e) => setMinGrowth(e.target.value)} />
        </div>
        <div>
          <label className="label">Sort</label>
          <select className="input" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => <option key={key} value={key}>{SORT_LABELS[key]}</option>)}
          </select>
        </div>
        <div className="text-sm ml-auto num" style={{ color: 'var(--text-faint)' }}>{filtered.length} of {artists.length}</div>
      </div>

      {selected.size > 0 && (
        <div className="card flex items-center gap-3 flex-wrap" style={{ borderColor: 'var(--accent-line)' }}>
          <span className="num text-sm font-semibold">{selected.size} selected</span>
          <select className="input w-auto" value={bulkStage} onChange={(e) => setBulkStage(e.target.value as Stage)}>
            {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
          </select>
          <button type="button" className="btn btn-primary text-sm" disabled={applying} onClick={applyBulkStage}>
            {applying ? 'Applying…' : 'Move to stage'}
          </button>
          <button type="button" className="btn text-sm" onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="card text-center py-12">
          <p style={{ color: 'var(--text-muted)' }}>No artists match these filters.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((artist, idx) => (
            <div key={artist.id} className="card flex items-center gap-3">
              <input
                type="checkbox"
                checked={selected.has(artist.id)}
                onChange={() => toggle(artist.id)}
                aria-label={`Select ${artist.name}`}
              />
              <Link href={`/artists/${artist.id}`} className="card-hover flex items-center justify-between gap-4 flex-1 min-w-0 -m-4 p-4 rounded-lg">
                <div className="flex items-center gap-4 min-w-0">
                  <span className="num text-sm w-6 shrink-0" style={{ color: 'var(--text-faint)' }}>#{idx + 1}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold truncate">{artist.name}</span>
                      <span className="badge">{STAGE_LABELS[artist.stage]}</span>
                      {artist.genre && <span className="text-xs" style={{ color: 'var(--text-faint)' }}>{artist.genre}</span>}
                    </div>
                    <div className="text-sm mt-1 flex gap-4 flex-wrap" style={{ color: 'var(--text-muted)' }}>
                      {artist.followers_count != null && <span className="num">{artist.followers_count.toLocaleString()} followers</span>}
                      {artist.growth_velocity_pct != null && <span className="num" style={{ color: 'var(--up)' }}>+{artist.growth_velocity_pct}%/mo</span>}
                      {artist.engagement_rate_pct != null && <span className="num">{artist.engagement_rate_pct}% engagement</span>}
                      {artist.scout_name && <span>Scout: {artist.scout_name}</span>}
                      {artist.created_by_name && <span>Added by {artist.created_by_name}</span>}
                    </div>
                  </div>
                </div>
                <ScoreBadge score={artist.score} />
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
