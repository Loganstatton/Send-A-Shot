import { Artist, SCORE_LABELS, SCORE_WEIGHTS, ScoreInputs } from '@/lib/types';

// The full 8-category split, for the internal Scout tool only — NEXT's
// public Artist Detail page deliberately stays at the coarser 2-bucket
// view (see scoreContributors()'s own comment in lib/scoring.ts: publicly
// showing "Professionalism: 4/10" about a real artist reads harsher than
// the same number sitting in an internal tool). A Scout needs the
// category-level detail to actually act on it.
const AUTO_DERIVED: (keyof ScoreInputs)[] = ['growth_velocity', 'engagement_quality'];
const HUMAN_RATED: (keyof ScoreInputs)[] = [
  'music_talent', 'original_song_response', 'brand_personality', 'content_consistency', 'commercial_potential', 'professionalism',
];

function CategoryBar({ field, value }: { field: keyof ScoreInputs; value: number }) {
  const points = value * (SCORE_WEIGHTS[field] / 10);
  const maxPoints = SCORE_WEIGHTS[field];
  const pct = maxPoints > 0 ? Math.max(0, Math.min(100, (points / maxPoints) * 100)) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-44 shrink-0 text-sm" style={{ color: 'var(--text-muted)' }}>{SCORE_LABELS[field]}</div>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
      </div>
      <div className="num text-sm w-28 text-right shrink-0">
        {value.toFixed(1)}/10 <span style={{ color: 'var(--text-faint)' }}>({points.toFixed(1)}pt)</span>
      </div>
    </div>
  );
}

export default function ScoreBreakdown({ artist }: { artist: Artist }) {
  return (
    <div className="card space-y-4">
      <h2 className="font-bold text-lg">Score breakdown</h2>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>Real data (auto-derived)</h3>
        {AUTO_DERIVED.map((field) => <CategoryBar key={field} field={field} value={artist[field]} />)}
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>Scout evaluation (human-rated)</h3>
        {HUMAN_RATED.map((field) => <CategoryBar key={field} field={field} value={artist[field]} />)}
      </div>
    </div>
  );
}
