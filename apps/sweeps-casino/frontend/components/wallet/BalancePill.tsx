"use client";

import { useEffect, useRef, useState } from "react";
import { useCurrencyStore } from "@/lib/stores/currency-store";
import { useWalletStore } from "@/lib/stores/wallet-store";
import { formatCoins, cn } from "@/lib/utils";

export function BalancePill() {
  const active = useCurrencyStore((s) => s.active);
  const balances = useWalletStore((s) => s.balances);
  const balance = active === "GC" ? balances?.gc.balance : balances?.sc.balance;

  // Restrained microinteraction (sprint item 11): a brief glow when the
  // active balance ticks up (claim, win, redemption, etc). Compares
  // against the previous render's balance rather than any richer delta
  // tracking, to keep this cheap.
  const prevBalanceRef = useRef<number | undefined>(balance);
  const [pulsing, setPulsing] = useState(false);

  useEffect(() => {
    const prev = prevBalanceRef.current;
    prevBalanceRef.current = balance;
    if (balance === undefined || prev === undefined || balance <= prev) return;
    setPulsing(true);
    const timer = setTimeout(() => setPulsing(false), 900);
    return () => clearTimeout(timer);
  }, [balance]);

  return (
    <div
      className={cn(
        "hidden items-baseline gap-1.5 rounded-full border px-3.5 py-1.5 font-mono text-sm font-bold md:flex",
        active === "GC" ? "border-accent-gc/30 text-accent-gc" : "border-accent-sc/30 text-accent-sc",
        pulsing && "animate-pulse-glow"
      )}
    >
      {balance !== undefined ? formatCoins(balance) : "—"}
      <span className="text-[10px] font-semibold text-text-muted">{active}</span>
    </div>
  );
}
