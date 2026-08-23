'use client';
import { useId, useMemo, useState } from 'react';
import { formatCents } from '@/lib/format';

type Point = { recorded_at: string; value: number };

// format is a string enum (not a function prop) because this is a client
// component receiving props from a server component — function values can't
// cross that boundary.
const FORMATTERS: Record<'cents' | 'number', (v: number) => string> = {
  cents: (c: number) => formatCents(c),
  number: (v: number) => v.toFixed(0),
};

const RANGES = [
  { key: '1D', label: '1D', ms: 24 * 60 * 60 * 1000 },
  { key: '1W', label: '1W', ms: 7 * 24 * 60 * 60 * 1000 },
  { key: '1M', label: '1M', ms: 30 * 24 * 60 * 60 * 1000 },
  { key: '3M', label: '3M', ms: 90 * 24 * 60 * 60 * 1000 },
  { key: 'ALL', label: 'ALL', ms: Infinity },
] as const;

type RangeKey = (typeof RANGES)[number]['key'];

// A stock-app-style price chart: big current value, $ + % change over the
// selected window, range tabs, and a line. Score history uses the same
// component (formatValue swapped) so the two histories — market price and
// NEXT Score — read the same way side by side.
export default function PriceChart({
  points,
  format = 'cents',
  color = 'auto',
}: {
  points: Point[];
  format?: 'cents' | 'number';
  color?: 'auto' | string;
}) {
  const [range, setRange] = useState<RangeKey>('ALL');
  const formatValue = FORMATTERS[format];
  const gradientId = `chart-fill-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const filtered = useMemo(() => {
    const cfg = RANGES.find((r) => r.key === range)!;
    if (cfg.ms === Infinity || points.length === 0) return points;
    const cutoff = Date.now() - cfg.ms;
    const kept = points.filter((p) => new Date(p.recorded_at).getTime() >= cutoff);
    // Always anchor the chart with at least one point before the window so
    // a flat "no activity in range" period isn't drawn as empty.
    if (kept.length >= 2) return kept;
    const lastBefore = [...points].reverse().find((p) => new Date(p.recorded_at).getTime() < cutoff);
    return lastBefore ? [lastBefore, ...kept] : kept;
  }, [points, range]);

  if (points.length === 0) {
    return <p className="text-sm py-8 text-center" style={{ color: 'var(--text-faint)' }}>No history yet.</p>;
  }

  const current = points[points.length - 1].value;
  const start = filtered.length > 0 ? filtered[0].value : current;
  const changeAbs = current - start;
  const changePct = start !== 0 ? (changeAbs / start) * 100 : 0;
  const up = changeAbs >= 0;
  const lineColor = color !== 'auto' ? color : up ? 'var(--up)' : 'var(--down)';

  const w = 600;
  const h = 160;
  const hasLine = points.length > 1;
  const vals = filtered.length > 1 ? filtered.map((p) => p.value) : [start, current];
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range_ = max - min || 1;
  const step = vals.length > 1 ? w / (vals.length - 1) : w;
  // Center a flat single-value line vertically instead of letting it settle
  // at the plot's floor — with min === max the naive formula puts it at y=0.
  const coords = hasLine
    ? vals.map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / range_) * h).toFixed(1)}`).join(' ')
    : '';
  const areaPath = hasLine ? `M0,${h} L${coords} L${w},${h} Z` : '';

  return (
    <div>
      <div className="flex items-end justify-between flex-wrap gap-2 mb-4">
        <div className="flex items-baseline gap-2.5">
          <span className="num font-display font-bold text-[28px] md:text-[32px]">{formatValue(current)}</span>
          <span className="num text-sm font-semibold" style={{ color: up ? 'var(--up)' : 'var(--down)' }}>
            {up ? '+' : ''}{formatValue(changeAbs).replace('-', '')} ({up ? '+' : ''}{changePct.toFixed(2)}%) {range === 'ALL' ? 'all time' : range}
          </span>
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              className="px-3 py-[5px] text-xs rounded-lg"
              style={
                range === r.key
                  ? { background: 'var(--ember-dim)', border: '1px solid var(--ember-line)', color: 'var(--ember)', fontWeight: 600 }
                  : { color: 'var(--text-faint)' }
              }
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      {hasLine ? (
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[180px]" preserveAspectRatio="none">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lineColor} stopOpacity="0.3" />
              <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
          <polyline points={coords} fill="none" stroke={lineColor} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
      ) : (
        <p className="text-sm h-[180px] flex items-center justify-center" style={{ color: 'var(--text-faint)' }}>Not enough history yet.</p>
      )}
    </div>
  );
}
