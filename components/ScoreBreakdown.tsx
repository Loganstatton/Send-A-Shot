import { Artist, SCORE_LABELS, SCORE_WEIGHTS, ScoreInputs } from '@/lib/types';

// The full 8-category breakdown, for the internal Scout tool only — NEXT's
// public Artist Detail page deliberately stays at the coarser 2-bucket
// view (see scoreContributors()'s own comment in lib/scoring.ts: publicly
// showing "Professionalism: 4/10" about a real artist reads harsher than
// the same number sitting in an internal tool). A Scout needs the
// category-level detail to actually act on it.
//
// Pre-beta migration: Growth Velocity/Engagement Quality used to be
// auto-derived from a real growth %/engagement % (typically Soundcharts-
// sourced) and were shown in their own "Real data (auto-derived)" group,
// separate from the other six Scout-rated categories. Both are now
// ordinary Scout-manual ratings, same as the rest (see the WRITABLE_FIELDS
// comment in lib/db.ts) — one flat list, no more "auto-derived" framing
// that would now be false.
const ALL_CATEGORIES: (keyof ScoreInputs)[] = [
  'music_talent', 'growth_velocity', 'engagement_quality', 'original_song_response',
  'brand_personality', 'content_consistency', 'commercial_potential', 'professionalism',
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
      <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
        All eight categories are your own 0-10 rating — see the sliders below to change any of them.
      </p>
      <div className="space-y-2">
        {ALL_CATEGORIES.map((field) => <CategoryBar key={field} field={field} value={artist[field]} />)}
      </div>
    </div>
  );
}
