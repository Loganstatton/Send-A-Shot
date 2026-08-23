// Trend-colored mini line chart (green if the last point is >= the first,
// red otherwise) — the "stock chart" read on a score history.
export default function Sparkline({ points, className = 'w-full h-16' }: { points: number[]; className?: string }) {
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
  const color = points[points.length - 1] >= points[0] ? 'var(--up)' : 'var(--down)';
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} preserveAspectRatio="none">
      <polyline points={coords} fill="none" stroke={color} strokeWidth={2} />
    </svg>
  );
}
