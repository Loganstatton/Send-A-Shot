"use client";

import { useEffect, useState } from "react";
import { useCurrencyStore } from "@/lib/stores/currency-store";
import { useWalletStore } from "@/lib/stores/wallet-store";
import { formatCoins, cn } from "@/lib/utils";
import { Coins } from "@/components/ui/icons";

/**
 * The currency switcher is the one control in the whole app where an
 * accidental click has real product meaning (which currency you play with
 * next), so it never auto-switches and always shows both balances at once
 * with the active one visually dominant — distinct color, distinct icon,
 * explicit "active" state.
 */
export function CurrencySwitcher() {
  const active = useCurrencyStore((s) => s.active);
  const setActive = useCurrencyStore((s) => s.setActive);
  const balances = useWalletStore((s) => s.balances);
  const fetchBalances = useWalletStore((s) => s.fetchBalances);
  const [confirming, setConfirming] = useState<"GC" | "SC" | null>(null);

  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  function select(currency: "GC" | "SC") {
    if (currency === active) return;
    setConfirming(currency);
  }

  function confirm() {
    if (confirming) setActive(confirming);
    setConfirming(null);
  }

  return (
    <div className="relative flex items-center rounded-full border border-border bg-surface-raised p-1">
      <button
        onClick={() => select("GC")}
        aria-pressed={active === "GC"}
        title="Gold Coins — entertainment-only, no cash value"
        className={cn(
          "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-all",
          active === "GC" ? "bg-accent-gc text-bg shadow-glow-gc" : "text-text-muted hover:text-accent-gc"
        )}
      >
        <Coins className="h-3.5 w-3.5" />
        GC
        {balances && <span className="hidden font-mono font-normal sm:inline">{formatCoins(balances.gc.balance)}</span>}
      </button>
      <button
        onClick={() => select("SC")}
        aria-pressed={active === "SC"}
        title="Sweeps Coins — promotional sweepstakes currency"
        className={cn(
          "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-all",
          active === "SC" ? "bg-accent-sc text-bg shadow-glow-sc" : "text-text-muted hover:text-accent-sc"
        )}
      >
        <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-current text-[8px]">
          S
        </span>
        SC
        {balances && <span className="hidden font-mono font-normal sm:inline">{formatCoins(balances.sc.balance)}</span>}
      </button>

      {confirming && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-64 origin-top-right rounded-lg border border-border bg-surface p-3 shadow-xl animate-scale-in">
          <p className="text-xs text-text-muted">
            Switch active play currency to{" "}
            <span className={cn("font-bold", confirming === "GC" ? "text-accent-gc" : "text-accent-sc")}>
              {confirming === "GC" ? "Gold Coins" : "Sweeps Coins"}
            </span>
            ?
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={confirm}
              className={cn(
                "flex-1 rounded-md py-1.5 text-xs font-semibold text-bg",
                confirming === "GC" ? "bg-accent-gc" : "bg-accent-sc"
              )}
            >
              Switch
            </button>
            <button
              onClick={() => setConfirming(null)}
              className="flex-1 rounded-md border border-border py-1.5 text-xs font-semibold text-text-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
