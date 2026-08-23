// One row of the "Why the Score is what it is" breakdown — a labeled bar
// sized by this bucket's share of the total Breakout Score. See
// scoreContributors() in lib/scoring.ts for what the two buckets are.
export default function ScoreContributorBar({
  label,
  points,
  total,
  color,
}: {
  label: string;
  points: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (points / total) * 100)) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-[168px] shrink-0 text-[12.5px]" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className="flex-1 h-[6px] rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="num text-[12.5px] font-semibold w-10 text-right shrink-0" style={{ color: 'var(--text)' }}>{points.toFixed(0)}</div>
    </div>
  );
}
