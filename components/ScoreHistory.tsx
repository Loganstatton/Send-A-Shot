'use client';
import { useEffect, useState } from 'react';
import { ScoreSnapshot } from '@/lib/types';
import Sparkline from './Sparkline';

export default function ScoreHistory({ artistId }: { artistId: number }) {
  const [history, setHistory] = useState<ScoreSnapshot[] | null>(null);

  useEffect(() => {
    fetch(`/api/artists/${artistId}/history`)
      .then((r) => r.json())
      .then(setHistory);
  }, [artistId]);

  if (history === null) {
    return (
      <div className="card">
        <h2 className="font-bold text-lg">Score history</h2>
        <p className="text-sm mt-2" style={{ color: 'var(--text-faint)' }}>Loading…</p>
      </div>
    );
  }

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
    </div>
  );
}
