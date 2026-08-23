import { formatCents } from '@/lib/format';

// Palette cycles rather than hashing per-artist (unlike heroGradient) —
// allocation order is already stable (largest position first), so a fixed
// cycle reads fine and needs no per-artist color logic.
const SWATCHES = ['var(--ember)', 'var(--up)', 'oklch(75% 0.14 260)', 'oklch(78% 0.13 320)', 'oklch(80% 0.12 90)', 'var(--text-faint)'];

export default function AllocationBreakdown({
  holdings,
  totalValueCents,
}: {
  holdings: { artist_id: number; artist_name: string; marketValueCents: number }[];
  totalValueCents: number;
}) {
  if (holdings.length === 0 || totalValueCents <= 0) return null;

  const sorted = [...holdings].sort((a, b) => b.marketValueCents - a.marketValueCents);

  return (
    <div className="next-card p-6 flex flex-col gap-4">
      <h2 className="font-display font-bold text-lg m-0">Allocation</h2>

      <div className="h-2.5 rounded-full overflow-hidden flex" style={{ background: 'var(--surface-2)' }}>
        {sorted.map((h, i) => (
          <div key={h.artist_id} style={{ width: `${(h.marketValueCents / totalValueCents) * 100}%`, background: SWATCHES[i % SWATCHES.length] }} />
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {sorted.map((h, i) => {
          const pct = (h.marketValueCents / totalValueCents) * 100;
          return (
            <div key={h.artist_id} className="flex items-center gap-2.5 text-sm">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: SWATCHES[i % SWATCHES.length] }} />
              <span className="flex-1 truncate">{h.artist_name}</span>
              <span className="num shrink-0" style={{ color: 'var(--text-faint)' }}>{formatCents(h.marketValueCents)}</span>
              <span className="num shrink-0 w-12 text-right font-semibold">{pct.toFixed(1)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
