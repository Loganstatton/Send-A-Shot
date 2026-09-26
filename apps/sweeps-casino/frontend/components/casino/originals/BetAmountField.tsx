"use client";

// Restyled only (Casino Visual Redesign, Phase C) — prop contract and the
// minor-units money model are unchanged.
import { useCurrencyStore } from "@/lib/stores/currency-store";
import { cn } from "@/lib/utils";

interface BetAmountFieldProps {
  valueMinor: number;
  onChange: (minor: number) => void;
  minMinor: number;
  maxMinor: number;
  disabled?: boolean;
}

/** Amount is tracked in integer minor units (cents-equivalent) to match the backend's fixed-point money model. */
export function BetAmountField({ valueMinor, onChange, minMinor, maxMinor, disabled }: BetAmountFieldProps) {
  const currency = useCurrencyStore((s) => s.active);
  const display = (valueMinor / 100).toFixed(2);

  function setFromString(s: string) {
    const num = Math.round(parseFloat(s || "0") * 100);
    if (Number.isNaN(num)) return;
    onChange(num);
  }

  function clamp(v: number) {
    return Math.min(maxMinor, Math.max(minMinor, v));
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-xs font-medium text-text-muted">Bet amount</label>
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[10px] font-bold",
            currency === "GC" ? "bg-accent-gc/15 text-accent-gc" : "bg-accent-sc/15 text-accent-sc"
          )}
        >
          {currency}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-text-muted">
            $
          </span>
          <input
            type="number"
            step="0.01"
            disabled={disabled}
            value={display}
            onChange={(e) => setFromString(e.target.value)}
            onBlur={() => onChange(clamp(valueMinor))}
            className="w-full rounded-xl border border-border bg-surface-raised py-2.5 pl-7 pr-3 text-sm font-mono font-semibold text-text-primary outline-none transition-colors focus:border-accent-sc disabled:opacity-50"
          />
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(clamp(Math.round(valueMinor / 2)))}
          className="rounded-lg border border-border bg-surface-raised px-2.5 py-2.5 text-xs font-semibold text-text-muted transition-colors hover:border-accent-sc/50 hover:text-text-primary disabled:opacity-50"
        >
          ½
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(clamp(valueMinor * 2))}
          className="rounded-lg border border-border bg-surface-raised px-2.5 py-2.5 text-xs font-semibold text-text-muted transition-colors hover:border-accent-sc/50 hover:text-text-primary disabled:opacity-50"
        >
          2×
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(maxMinor)}
          className="rounded-lg border border-border bg-surface-raised px-2.5 py-2.5 text-xs font-semibold text-text-muted transition-colors hover:border-accent-sc/50 hover:text-text-primary disabled:opacity-50"
        >
          Max
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-text-muted">
        Min {(minMinor / 100).toFixed(2)} · Max {(maxMinor / 100).toFixed(2)} {currency}
      </p>
    </div>
  );
}
