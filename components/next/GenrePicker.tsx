'use client';

// Toggle chips for choosing genres. Each chip is a button with
// aria-pressed, so screen readers announce it as on/off.
export default function GenrePicker({
  options, selected, onChange, max, labelledBy,
}: { options: string[]; selected: string[]; onChange: (next: string[]) => void; max: number; labelledBy?: string }) {
  const atMax = selected.length >= max;
  return (
    <div role="group" aria-labelledby={labelledBy} className="flex flex-wrap gap-2">
      {options.map((g) => {
        const on = selected.includes(g);
        return (
          <button
            key={g}
            type="button"
            aria-pressed={on}
            disabled={!on && atMax}
            onClick={() => onChange(on ? selected.filter((s) => s !== g) : [...selected, g])}
            className={`next-pill ${on ? 'next-pill-active' : ''}`}
            style={!on && atMax ? { opacity: 0.45 } : undefined}
          >
            {on ? '✓ ' : ''}{g}
          </button>
        );
      })}
    </div>
  );
}
