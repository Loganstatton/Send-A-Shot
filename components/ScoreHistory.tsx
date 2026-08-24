import { SCORE_LABELS, ScoreInputs, ScoreSnapshot } from '@/lib/types';
import Sparkline from './Sparkline';

const COMPONENT_FIELDS = Object.keys(SCORE_LABELS) as (keyof ScoreInputs)[];

// Every category that actually changed between the two most recent
// snapshots — score_history already stores all 8 component values per
// snapshot (not just the total), so this is a pure client-side diff, no
// API change needed.
function ComponentChanges({ previous, latest }: { previous: ScoreSnapshot; latest: ScoreSnapshot }) {
  const changes = COMPONENT_FIELDS
    .map((field) => ({ field, from: previous[field], to: latest[field] }))
    .filter((c) => c.from !== c.to);

  if (changes.length === 0) return null;

  return (
    <div className="space-y-1.5 pt-2" style={{ borderTop: '1px solid var(--border-soft)' }}>
      <h3 className="text-sm font-semibold">What changed since the last snapshot</h3>
      {changes.map((c) => {
        const delta = Math.round((c.to - c.from) * 10) / 10;
        return (
          <div key={c.field} className="flex items-center justify-between text-sm">
            <span style={{ color: 'var(--text-muted)' }}>{SCORE_LABELS[c.field]}</span>
            <span className="num">
              {c.from.toFixed(1)} → {c.to.toFixed(1)}{' '}
              <span style={{ color: delta > 0 ? 'var(--up)' : 'var(--down)' }}>({delta > 0 ? '+' : ''}{delta})</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function ScoreHistory({ initial }: { initial: ScoreSnapshot[] }) {
  const history = initial;

  if (history.length === 0) {
    return (
      <div className="card">
        <h2 className="font-bold text-lg">Score history</h2>
        <p className="text-sm mt-2" style={{ color: 'var(--text-faint)' }}>No snapshots yet — history is recorded automatically on every save.</p>
      </div>
    );
  }

  const scores = history.map((h) => h.breakout_score);
  const first = scores[0];
  const last = scores[scores.length - 1];
  const delta = Math.round((last - first) * 10) / 10;

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-lg">Score history</h2>
        {history.length > 1 && (
          <span className="num text-sm font-medium" style={{ color: delta > 0 ? 'var(--up)' : delta < 0 ? 'var(--down)' : 'var(--text-muted)' }}>
            {delta > 0 ? '+' : ''}{delta} since first tracked
          </span>
        )}
      </div>
      <Sparkline points={scores} />
      <div className="max-h-40 overflow-y-auto text-sm">
        <table className="w-full">
          <thead className="text-left">
            <tr>
              <th className="font-normal pb-1" style={{ color: 'var(--text-faint)' }}>Date</th>
              <th className="font-normal pb-1" style={{ color: 'var(--text-faint)' }}>Stage</th>
              <th className="font-normal pb-1 text-right" style={{ color: 'var(--text-faint)' }}>Score</th>
            </tr>
          </thead>
          <tbody>
            {[...history].reverse().map((snap) => (
              <tr key={snap.id} style={{ borderTop: '1px solid var(--border-soft)' }}>
                <td className="num py-1" style={{ color: 'var(--text-muted)' }}>{new Date(snap.recorded_at).toLocaleDateString()}</td>
                <td className="py-1 capitalize" style={{ color: 'var(--text-muted)' }}>{snap.stage}</td>
                <td className="num py-1 text-right font-medium">{snap.breakout_score.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {history.length > 1 && <ComponentChanges previous={history[history.length - 2]} latest={history[history.length - 1]} />}
    </div>
  );
}
