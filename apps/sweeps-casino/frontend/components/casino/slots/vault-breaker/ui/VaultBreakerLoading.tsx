"use client";

// Branded loading state while the config fetch + Pixi texture build are in
// flight — mirrors GameLoading.tsx's convention (never a blank screen or an
// abrupt cut-in) but styled for Vault Breaker specifically, with its own
// "Vaultline Studios" developer credit line per the brief.
import { VaultlineLogo } from "@/components/ui/VaultlineLogo";

export function VaultBreakerLoading({ progress }: { progress?: number }) {
  const pct = Math.max(6, Math.min(100, progress ?? 30));
  return (
    <div className="bg-casino-ambient relative flex min-h-[70vh] flex-col items-center justify-center gap-5 overflow-hidden rounded-2xl">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(circle at 50% 40%, rgba(45,191,176,0.22) 0%, rgba(212,175,55,0.08) 45%, transparent 70%)",
        }}
      />
      <VaultlineLogo className="relative h-14 w-14 animate-pulse" />
      <div className="relative text-center">
        <p className="text-lg font-extrabold tracking-wide text-text-primary">VAULT BREAKER</p>
        <p className="mt-1 text-[11px] uppercase tracking-[0.3em] text-accent-sc/80">Vaultline Studios</p>
      </div>
      <div className="relative h-1.5 w-48 overflow-hidden rounded-full bg-surface-raised">
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent-sc to-accent-gc transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="relative text-[11px] text-text-muted">Loading the vault…</p>
    </div>
  );
}
