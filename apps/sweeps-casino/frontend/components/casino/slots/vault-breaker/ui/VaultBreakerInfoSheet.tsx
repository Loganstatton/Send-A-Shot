"use client";

// Paytable + plain-language rules + Provably Fair, opened from a menu
// button off the primary reel screen. Reuses the shared BottomSheet
// primitive (its prop contract fits directly) rather than GameInfoSheet,
// whose rotate/client-seed flow is Originals-specific
// (/casino/originals/seeds/rotate) and doesn't apply to slots rounds — so
// Fair Play here is a restrained, read-only display of the real seed state
// already returned by the config endpoint, plus a link to verify a past
// round, instead of a second bespoke rotate UI.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { ChevronRight, Shield } from "@/components/ui/icons";
import { renderSymbolToDataURL } from "../art/symbolTextures";
import { cn } from "@/lib/utils";
import type { SlotConfig, SlotSymbolId } from "@/lib/types";

function formatGC(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type Tab = "paytable" | "rules" | "fair";

export function VaultBreakerInfoSheet({
  open,
  onClose,
  config,
}: {
  open: boolean;
  onClose: () => void;
  config: SlotConfig;
}) {
  const [tab, setTab] = useState<Tab>("paytable");
  const [art, setArt] = useState<Partial<Record<SlotSymbolId, string>>>({});

  // Symbol art needs `document` (canvas), so it's built lazily client-side
  // the first time the sheet opens rather than at module load.
  useEffect(() => {
    if (!open || Object.keys(art).length > 0) return;
    const next: Partial<Record<SlotSymbolId, string>> = {};
    for (const s of config.symbols) next[s.id] = renderSymbolToDataURL(s.id);
    setArt(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const payingSymbols = useMemo(
    () =>
      [...config.symbols]
        .filter((s) => s.role === "PAYING")
        .sort((a, b) => (config.paytable[b.id]?.["5"] ?? 0) - (config.paytable[a.id]?.["5"] ?? 0)),
    [config.symbols, config.paytable]
  );
  const wild = config.symbols.find((s) => s.role === "WILD");
  const scatter = config.symbols.find((s) => s.role === "SCATTER");
  const scatterCounts = Object.keys(config.freeSpins.spinsAwarded).sort((a, b) => Number(a) - Number(b));

  return (
    <BottomSheet open={open} onClose={onClose} title="Vault Breaker — Info">
      <div className="mb-4 flex gap-1.5 rounded-full bg-surface-raised p-1">
        {(["paytable", "rules", "fair"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 rounded-full py-1.5 text-xs font-semibold capitalize transition-colors duration-150",
              tab === t ? "bg-accent-sc text-bg" : "text-text-muted hover:text-text-primary"
            )}
          >
            {t === "fair" ? "Fair Play" : t}
          </button>
        ))}
      </div>

      {tab === "paytable" && (
        <div className="space-y-2">
          {payingSymbols.map((s) => {
            const row = config.paytable[s.id] ?? {};
            return (
              <div key={s.id} className="flex items-center gap-3 rounded-xl bg-surface-raised px-3 py-2">
                {art[s.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={art[s.id]} alt={s.name} className="h-11 w-11 shrink-0 rounded-lg" />
                ) : (
                  <div className="h-11 w-11 shrink-0 animate-pulse rounded-lg bg-border/50" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-text-primary">{s.name}</p>
                  <div className="mt-0.5 flex gap-3 font-mono text-[11px] text-text-muted">
                    {["3", "4", "5"].map((count) =>
                      row[count] != null ? (
                        <span key={count}>
                          {count}× <span className="text-accent-gc">{row[count]}x</span>
                        </span>
                      ) : null
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <p className="pt-1 text-center text-[10px] text-text-muted">
            Payouts are multipliers of total bet, paid on the highest match per payline · {config.paylineCount} paylines
          </p>
        </div>
      )}

      {tab === "rules" && (
        <div className="space-y-4 text-sm text-text-secondary">
          {wild && art[wild.id] && (
            <div className="flex gap-3 rounded-xl bg-surface-raised p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={art[wild.id]} alt="Wild" className="h-12 w-12 shrink-0 rounded-lg" />
              <div>
                <p className="font-semibold text-text-primary">Wild — {wild.name}</p>
                <p className="mt-0.5 text-xs text-text-muted">
                  Substitutes for any paying symbol to complete a winning payline.
                </p>
              </div>
            </div>
          )}
          {scatter && art[scatter.id] && (
            <div className="flex gap-3 rounded-xl bg-surface-raised p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={art[scatter.id]} alt="Scatter" className="h-12 w-12 shrink-0 rounded-lg" />
              <div>
                <p className="font-semibold text-text-primary">Scatter — {scatter.name}</p>
                <p className="mt-0.5 text-xs text-text-muted">
                  Pays anywhere on the grid, doesn&apos;t need to line up on a payline.
                </p>
              </div>
            </div>
          )}
          <div className="rounded-xl bg-surface-raised p-3">
            <p className="font-semibold text-text-primary">Free Spins — Vault Breach</p>
            <ul className="mt-1.5 space-y-1 text-xs text-text-muted">
              {scatterCounts.map((c) => (
                <li key={c}>
                  {c} scatters → <span className="text-accent-sc">{config.freeSpins.spinsAwarded[c]} free spins</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-text-muted">
              The Vault Multiplier starts at{" "}
              <span className="text-accent-gc">{config.freeSpinsMultiplier.startMultiplier}x</span> and can climb up to{" "}
              <span className="text-accent-gc">{config.freeSpinsMultiplier.maxMultiplier}x</span> as free spins play out.
            </p>
          </div>
        </div>
      )}

      {tab === "fair" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs font-medium text-accent-sc">
            <Shield className="h-3.5 w-3.5" />
            Provably Fair
          </div>
          <div>
            <p className="text-[11px] font-medium text-text-muted">Hashed server seed</p>
            <p className="mt-1 break-all rounded-lg bg-surface-raised px-3 py-2.5 font-mono text-[11px] text-text-primary">
              {config.serverSeedHash}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-medium text-text-muted">Client seed</p>
            <p className="mt-1 break-all rounded-lg bg-surface-raised px-3 py-2.5 font-mono text-[11px] text-text-primary">
              {config.clientSeed}
            </p>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-surface-raised px-3 py-2.5 text-[11px] text-text-muted">
            <span>
              Nonce <span className="font-mono text-text-primary">{config.nonce}</span>
            </span>
          </div>
          <Link
            href="/provably-fair"
            className="flex items-center justify-center gap-1 pt-1 text-xs font-medium text-accent-sc hover:underline"
          >
            Verify a past round
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      <p className="mt-5 border-t border-border pt-3 text-center font-mono text-[10px] text-text-muted">
        Min bet {formatGC(config.minBet)} GC · Max bet {formatGC(config.maxBet)} GC
      </p>
    </BottomSheet>
  );
}
