"use client";

// Branded loading state for an Original while its config is fetched, in
// place of a generic gray skeleton block (Casino Visual Redesign, Phase C
// — spec items 31-34).
import { VaultlineLogo } from "@/components/ui/VaultlineLogo";

export function GameLoading({ label }: { label: string }) {
  return (
    <div className="bg-casino-ambient flex min-h-[70vh] flex-col items-center justify-center gap-4 rounded-2xl">
      <VaultlineLogo className="h-11 w-11 animate-pulse" />
      <p className="text-sm font-medium tracking-wide text-text-muted">Loading {label}…</p>
      <div className="h-1 w-36 overflow-hidden rounded-full bg-surface-raised">
        <div className="skeleton h-full w-full" />
      </div>
    </div>
  );
}
