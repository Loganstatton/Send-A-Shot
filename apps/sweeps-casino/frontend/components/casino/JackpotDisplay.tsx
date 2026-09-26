"use client";

// DEMO DATA ONLY — pure frontend visual, not backed by any real aggregate
// query or ledger data. There is no real jackpot system in this codebase
// yet (no backend endpoint, no Prisma model) — this must remain a
// client-side "feels alive" number, seeded and incremented locally, until
// an actual jackpot system is built. Do not wire this to any endpoint or
// invent one. The "VIEW JACKPOT GAMES" CTA links to the real catalog
// (games tagged JACKPOT via the Casino page's filter), so that part stays
// honest even though the total itself is a demo.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Coins, ArrowRight } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

const SEED = 2_847_391;
const TICK_MS_MIN = 4000;
const TICK_MS_MAX = 8000;
const INCREMENT_MIN = 50;
const INCREMENT_MAX = 400;

// Fixed (non-random) particle field so server- and client-render match —
// no hydration mismatch from Math.random() at render time. Purely
// decorative, aria-hidden.
const PARTICLES = [
  { left: "8%", size: 3, delay: "0s", duration: "4.2s" },
  { left: "18%", size: 2, delay: "1.1s", duration: "5s" },
  { left: "29%", size: 4, delay: "0.4s", duration: "4.8s" },
  { left: "41%", size: 2, delay: "2.2s", duration: "4.4s" },
  { left: "54%", size: 3, delay: "0.9s", duration: "5.3s" },
  { left: "66%", size: 2, delay: "1.8s", duration: "4.6s" },
  { left: "77%", size: 4, delay: "0.2s", duration: "5.1s" },
  { left: "89%", size: 2, delay: "1.4s", duration: "4.3s" },
];

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
    <div className="bg-glow-jackpot relative mb-4 overflow-hidden rounded-2xl border border-accent-gc/25">
      {/* Vault-gold lighting base */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 120%, rgb(var(--color-accent-gc) / 0.22), transparent 60%), linear-gradient(180deg, rgb(var(--color-surface-raised)) 0%, rgb(var(--color-bg)) 100%)",
        }}
      />
      {/* Faint vault-door concentric arcs, echoing the hero's motif */}
      <svg className="absolute -right-6 -top-10 h-[220%] w-[45%] opacity-[0.12] sm:w-[30%]" viewBox="0 0 200 200" aria-hidden>
        {[92, 76, 60, 44, 28].map((r) => (
          <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="white" strokeWidth={1.5} strokeDasharray="6 5" />
        ))}
      </svg>
      {/* Particle field */}
      <div className="absolute inset-0 overflow-hidden" aria-hidden>
        {PARTICLES.map((p, i) => (
          <span
            key={i}
            className="animate-particle-float absolute rounded-full bg-accent-gc"
            style={{
              left: p.left,
              bottom: "18%",
              width: p.size,
              height: p.size,
              animationDelay: p.delay,
              animationDuration: p.duration,
              boxShadow: "0 0 6px 1px rgb(var(--color-accent-gc) / 0.6)",
            }}
          />
        ))}
      </div>

      <div className="relative z-10 flex flex-col items-center gap-2 px-6 py-8 text-center sm:py-10">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-accent-gc/80">
          <Coins className="h-4 w-4" />
          Vaultline Jackpot
        </div>
        <p className="animate-jackpot-pulse text-glow-gold font-mono text-4xl font-extrabold tabular-nums tracking-tight sm:text-6xl">
          {total.toLocaleString("en-US")} <span className="text-2xl font-bold sm:text-3xl">GC</span>
        </p>
        <Link
          href="/casino?filter=jackpots"
          className={cn(
            "group mt-2 inline-flex items-center gap-1.5 rounded-full border border-accent-gc/40 bg-accent-gc/10 px-4 py-2 text-xs font-bold uppercase tracking-wide text-accent-gc transition-colors hover:bg-accent-gc/20"
          )}
        >
          View Jackpot Games
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </div>
  );
}
