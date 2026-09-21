"use client";

import { useCurrencyStore } from "@/lib/stores/currency-store";
import { useWalletStore } from "@/lib/stores/wallet-store";
import { formatCoins, cn } from "@/lib/utils";

export function BalancePill() {
  const active = useCurrencyStore((s) => s.active);
  const balances = useWalletStore((s) => s.balances);
  const balance = active === "GC" ? balances?.gc.balance : balances?.sc.balance;

  return (
    <div
      className={cn(
        "hidden items-baseline gap-1.5 rounded-full border px-3.5 py-1.5 font-mono text-sm font-bold md:flex",
        active === "GC" ? "border-accent-gc/30 text-accent-gc" : "border-accent-sc/30 text-accent-sc"
      )}
    >
      {balance !== undefined ? formatCoins(balance) : "—"}
      <span className="text-[10px] font-semibold text-text-muted">{active}</span>
    </div>
  );
}
