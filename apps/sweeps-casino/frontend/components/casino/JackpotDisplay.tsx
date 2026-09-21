"use client";

// DEMO DATA ONLY — pure frontend visual, not backed by any real aggregate
// query or ledger data. There is no real jackpot system in this codebase
// yet (no backend endpoint, no Prisma model) — this must remain a
// client-side "feels alive" number, seeded and incremented locally, until
// an actual jackpot system is built. Do not wire this to any endpoint or
// invent one.

import { useEffect, useState } from "react";
import { Coins } from "@/components/ui/icons";

const SEED = 2_847_391;
const TICK_MS_MIN = 4000;
const TICK_MS_MAX = 8000;
const INCREMENT_MIN = 50;
const INCREMENT_MAX = 400;

export function JackpotDisplay() {
  const [total, setTotal] = useState(SEED);

  useEffect(() => {
    let cancelled = false;
    function schedule() {
      const delay = TICK_MS_MIN + Math.random() * (TICK_MS_MAX - TICK_MS_MIN);
      return setTimeout(() => {
        if (cancelled) return;
        const increment = Math.round(INCREMENT_MIN + Math.random() * (INCREMENT_MAX - INCREMENT_MIN));
        setTotal((t) => t + increment);
        timer = schedule();
      }, delay);
    }
    let timer = schedule();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className="bg-casino-vignette relative mb-4 flex flex-col items-center gap-1.5 overflow-hidden rounded-2xl border border-accent-gc/20 bg-gradient-to-b from-accent-gc/10 to-transparent px-6 py-6 text-center sm:py-8">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-accent-gc/80">
        <Coins className="h-4 w-4" />
        Vaultline Jackpot
      </div>
      <p className="animate-jackpot-pulse text-glow-gold font-mono text-4xl font-extrabold tabular-nums tracking-tight sm:text-5xl">
        {total.toLocaleString("en-US")} <span className="text-2xl font-bold sm:text-3xl">GC</span>
      </p>
    </div>
  );
}
