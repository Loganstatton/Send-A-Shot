import Link from "next/link";
import { Shield } from "@/components/ui/icons";

// Providers, Phase 1: Vaultline Originals only. Do NOT fabricate logos for
// real studios (no NetEnt/Pragmatic/Evolution-style marks, nothing that
// could be mistaken for a real integration) — real provider logos land
// here only once we actually integrate with them.
export function ProviderRail() {
  return (
    <section className="mb-8 px-4 lg:px-6">
      <h2 className="mb-3 text-lg font-bold text-text-primary">Providers</h2>
      <Link
        href="/casino/originals/dice"
        className="group relative flex items-center gap-4 overflow-hidden rounded-xl border border-border/60 bg-gradient-to-br from-surface-raised to-surface p-5 transition-colors hover:border-accent-gc/40"
      >
        <span
          className="coin-shimmer flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent-gc to-accent-sc text-lg font-extrabold text-bg"
          aria-hidden
        >
          V
        </span>
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-bold text-text-primary">
            Vaultline Originals
            <Shield className="h-3.5 w-3.5 text-accent-sc" />
          </p>
          <p className="text-xs text-text-muted">House-built, provably-fair games — more providers coming soon.</p>
        </div>
      </Link>
    </section>
  );
}
