// One cell of NEXT's market-stats strip — shared by Discover's header row
// and Portfolio's summary row so both read the same way.
export default function NextStatTile({
  label,
  value,
  valueTone,
  delta,
  deltaTone,
}: {
  label: string;
  value: string;
  valueTone?: 'up' | 'down' | 'ember';
  delta?: string;
  deltaTone?: 'up' | 'down' | 'ember';
}) {
  return (
    <div className="flex flex-col gap-1.5 px-[22px] py-5" style={{ background: 'var(--surface)' }}>
      <span className="text-[11.5px] uppercase tracking-[0.06em] font-mono" style={{ color: 'var(--text-faint)' }}>{label}</span>
      <span className="flex items-baseline gap-1.5 min-w-0">
        <span className="num font-display font-bold text-xl truncate" style={{ color: valueTone ? `var(--${valueTone})` : undefined }}>{value}</span>
        {delta && <span className="num text-[13px] font-semibold shrink-0" style={{ color: deltaTone ? `var(--${deltaTone})` : 'var(--text-faint)' }}>{delta}</span>}
      </span>
    </div>
  );
}
