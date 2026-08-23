// NEXT-themed trend line — same shape as components/Sparkline.tsx but using
// the design tokens (var(--up)/var(--down)) instead of hardcoded hex, plus
// an optional soft area fill for cards the grid wants to emphasize.
export default function PriceSparkline({
  points,
  filled = false,
  className = 'w-full h-[34px]',
}: {
  points: number[];
  filled?: boolean;
  className?: string;
}) {
  if (points.length < 2) return null;
  const w = 240;
  const h = 34;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const up = points[points.length - 1] >= points[0];
  const color = up ? 'var(--up)' : 'var(--down)';
  const line = points
    .map((p, i) => `${(i * step).toFixed(1)},${(h - ((p - min) / range) * (h - 4) - 2).toFixed(1)}`)
    .join(' L');
  const path = `M${line}`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} preserveAspectRatio="none">
      {filled && (
        <>
          <defs>
            <linearGradient id={`spark-fill-${up ? 'up' : 'down'}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.35" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${path} L${w},${h} L0,${h} Z`} fill={`url(#spark-fill-${up ? 'up' : 'down'})`} />
        </>
      )}
      <path d={path} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
