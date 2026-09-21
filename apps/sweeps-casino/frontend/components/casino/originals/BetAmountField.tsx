"use client";

import { useCurrencyStore } from "@/lib/stores/currency-store";
import { Button } from "@/components/ui/Button";
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
            "text-[10px] font-bold",
            currency === "GC" ? "text-accent-gc" : "text-accent-sc"
          )}
        >
          {currency}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type="number"
            step="0.01"
            disabled={disabled}
            value={display}
            onChange={(e) => setFromString(e.target.value)}
            onBlur={() => onChange(clamp(valueMinor))}
            className="w-full rounded-lg border border-border bg-surface-raised px-3.5 py-2.5 text-sm font-mono text-text-primary outline-none focus:border-accent-sc disabled:opacity-50"
          />
        </div>
        <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => onChange(clamp(Math.round(valueMinor / 2)))}>
          ½
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => onChange(clamp(valueMinor * 2))}>
          2×
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => onChange(maxMinor)}>
          Max
        </Button>
      </div>
      <p className="mt-1 text-[11px] text-text-muted">
        Min {(minMinor / 100).toFixed(2)} · Max {(maxMinor / 100).toFixed(2)} {currency}
      </p>
    </div>
  );
}
