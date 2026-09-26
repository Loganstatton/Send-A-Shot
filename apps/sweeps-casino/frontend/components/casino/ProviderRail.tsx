import Link from "next/link";
import { Shield, Clock } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

// Providers, Phase 1: Vaultline Originals only. Do NOT fabricate logos for
// real studios (no NetEnt/Pragmatic/Evolution-style marks, nothing that
// could be mistaken for a real integration) — real provider logos land
// here only once we actually integrate with them. The two "Coming Soon"
// slots are honest placeholders (no name, no logo) rather than invented
// studio names.

function ProviderTile({
  href,
  label,
  sub,
  disabled,
}: {
  href?: string;
  label: string;
  sub: string;
  disabled?: boolean;
}) {
  const content = (
    <div
      className={cn(
        "group relative flex h-full min-w-[220px] flex-1 shrink-0 items-center gap-3 overflow-hidden rounded-xl border px-4 py-4 transition-colors sm:min-w-0",
        disabled
          ? "border-border/40 bg-surface/40"
          : "border-border/60 bg-gradient-to-br from-surface-raised to-surface hover:border-accent-gc/40"
      )}
    >
      <span
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-base font-extrabold",
          disabled
            ? "border border-dashed border-border text-text-muted"
            : "coin-shimmer bg-gradient-to-br from-accent-gc to-accent-sc text-bg"
        )}
        aria-hidden
      >
        {disabled ? <Clock className="h-4 w-4" /> : "V"}
      </span>
      <div className="min-w-0">
        <p
          className={cn(
            "flex items-center gap-1.5 truncate text-sm font-bold",
            disabled ? "text-text-muted" : "text-text-primary"
          )}
        >
          {label}
          {!disabled && <Shield className="h-3.5 w-3.5 shrink-0 text-accent-sc" />}
        </p>
        <p className="truncate text-xs text-text-muted">{sub}</p>
      </div>
    </div>
  );

  if (disabled || !href) return content;
  return (
    <Link href={href} className="contents">
      {content}
    </Link>
  );
}

export function ProviderRail() {
  return (
    <section className="mb-8 px-4 lg:px-6">
      <h2 className="mb-3 text-lg font-bold text-text-primary">Providers</h2>
      <div className="no-scrollbar flex gap-3 overflow-x-auto pb-1 sm:grid sm:grid-cols-3">
        <ProviderTile href="/casino/originals/dice" label="Vaultline Originals" sub="House-built, provably-fair games" />
        <ProviderTile label="Coming Soon" sub="More studios joining the vault" disabled />
        <ProviderTile label="Coming Soon" sub="More studios joining the vault" disabled />
      </div>
    </section>
  );
}
