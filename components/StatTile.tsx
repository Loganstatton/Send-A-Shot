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
  const deltaColor = deltaTone === 'up' ? 'text-emerald-400' : deltaTone === 'down' ? 'text-red-400' : 'text-neutral-400';
  return (
    <div className="card py-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="flex items-baseline gap-2 mt-1 min-w-0">
        <div className="text-lg font-semibold truncate">{value}</div>
        {delta && <div className={`text-sm font-medium shrink-0 ${deltaColor}`}>{delta}</div>}
      </div>
    </div>
  );
}
