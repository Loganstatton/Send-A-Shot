export default function StatTile({
  label,
  value,
  delta,
  deltaTone = 'neutral',
}: {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: 'up' | 'down' | 'neutral';
}) {
  const deltaColor = deltaTone === 'up' ? 'var(--up)' : deltaTone === 'down' ? 'var(--down)' : 'var(--text-muted)';
  return (
    <div className="card py-3">
      <div className="text-[11px] uppercase tracking-[0.04em]" style={{ color: 'var(--text-faint)' }}>{label}</div>
      <div className="flex items-baseline gap-2 mt-1 min-w-0">
        <div className="num text-lg font-semibold truncate">{value}</div>
        {delta && <div className="num text-sm font-medium shrink-0" style={{ color: deltaColor }}>{delta}</div>}
      </div>
    </div>
  );
}
