"use client";

// Tap-to-open chip-style bet picker. Presets are generated from the real
// config.minBet/maxBet (never hardcoded amounts) — a roughly-geometric
// progression from min to max, deduped, always ending on max.
import { BottomSheet } from "@/components/ui/BottomSheet";
import { cn } from "@/lib/utils";

function formatGC(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function buildBetPresets(min: number, max: number): number[] {
  if (min >= max) return [min];
  const multipliers = [1, 2, 5, 10, 25, 50, 100, 250];
  const raw = multipliers.map((m) => min * m).filter((v) => v <= max);
  const values = new Set<number>();
  raw.forEach((v) => values.add(Math.round(v * 100) / 100));
  values.add(min);
  values.add(max);
  return Array.from(values)
    .filter((v) => v >= min && v <= max)
    .sort((a, b) => a - b)
    .slice(0, 9);
}

interface BetChipPickerProps {
  open: boolean;
  onClose: () => void;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}

export function BetChipPicker({ open, onClose, value, min, max, disabled, onChange }: BetChipPickerProps) {
  const presets = buildBetPresets(min, max);

  return (
    <BottomSheet open={open} onClose={onClose} title="Bet Amount">
      <div className="mb-4 flex items-baseline justify-between rounded-xl bg-surface-raised px-4 py-3">
        <span className="text-xs font-medium text-text-muted">Selected bet</span>
        <span className="font-mono text-lg font-bold text-accent-gc">{formatGC(value)} GC</span>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        {presets.map((amount) => {
          const active = Math.abs(amount - value) < 0.001;
          return (
            <button
              key={amount}
              type="button"
              disabled={disabled}
              onClick={() => {
                onChange(amount);
                onClose();
              }}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 rounded-full border py-3.5 font-mono text-sm font-bold transition-all duration-150 ease-snappy active:scale-95 disabled:opacity-50",
                active
                  ? "border-accent-gc bg-accent-gc/15 text-accent-gc shadow-glow-gc"
                  : "border-border bg-surface-raised text-text-primary hover:border-accent-gc/40"
              )}
            >
              {formatGC(amount)}
              <span className="text-[9px] font-semibold uppercase tracking-wide text-text-muted">GC</span>
            </button>
          );
        })}
      </div>

      <p className="mt-4 text-center text-[11px] text-text-muted">
        Min {formatGC(min)} · Max {formatGC(max)} GC
      </p>
    </BottomSheet>
  );
}
