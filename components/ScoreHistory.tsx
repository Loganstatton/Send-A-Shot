'use client';
import { useEffect, useState } from 'react';
import { ScoreSnapshot } from '@/lib/types';

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const w = 300;
  const h = 60;
  const min = Math.min(...points, 0);
  const max = Math.max(...points, 100);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const coords = points
    .map((p, i) => `${(i * step).toFixed(1)},${(h - ((p - min) / range) * h).toFixed(1)}`)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-16" preserveAspectRatio="none">
      <polyline points={coords} fill="none" stroke="#3b82f6" strokeWidth={2} />
    </svg>
  );
}

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
        <h2 className="font-semibold text-lg">Score history</h2>
        <p className="text-sm text-neutral-500 mt-2">Loading…</p>
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="card">
        <h2 className="font-semibold text-lg">Score history</h2>
        <p className="text-sm text-neutral-500 mt-2">No snapshots yet — history is recorded automatically on every save.</p>
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
        <h2 className="font-semibold text-lg">Score history</h2>
        {history.length > 1 && (
          <span className={`text-sm font-medium ${delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-red-400' : 'text-neutral-400'}`}>
            {delta > 0 ? '+' : ''}{delta} since first tracked
          </span>
        )}
      </div>
      <Sparkline points={scores} />
      <div className="max-h-40 overflow-y-auto text-sm">
        <table className="w-full">
          <thead className="text-neutral-500 text-left">
            <tr>
              <th className="font-normal pb-1">Date</th>
              <th className="font-normal pb-1">Stage</th>
              <th className="font-normal pb-1 text-right">Score</th>
            </tr>
          </thead>
          <tbody>
            {[...history].reverse().map((snap) => (
              <tr key={snap.id} className="border-t border-neutral-800">
                <td className="py-1 text-neutral-400">{new Date(snap.recorded_at).toLocaleDateString()}</td>
                <td className="py-1 text-neutral-400 capitalize">{snap.stage}</td>
                <td className="py-1 text-right font-medium">{snap.breakout_score.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
