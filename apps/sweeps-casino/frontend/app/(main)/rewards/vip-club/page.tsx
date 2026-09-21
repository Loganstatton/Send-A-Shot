"use client";

import { useCallback } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { useFetch } from "@/lib/hooks/useFetch";
import { api } from "@/lib/api-client";
import type { VipLevel, VipSummary } from "@/lib/types";
import { Trophy } from "@/components/ui/icons";
import { cn, formatCoins } from "@/lib/utils";
import { tierStyleForRank } from "@/lib/vip-tiers";

function formatXp(value: string | number) {
  return Math.round(Number(value)).toLocaleString();
}

export default function VipClubPage() {
  const meFetcher = useCallback(() => api.get<VipSummary>("/vip/me"), []);
  const { data: me, loading: meLoading } = useFetch(meFetcher);

  const levelsFetcher = useCallback(() => api.get<VipLevel[]>("/vip/levels"), []);
  const { data: levels, loading: levelsLoading } = useFetch(levelsFetcher);

  const intoLevel = Number(me?.progress.pointsIntoLevel ?? 0);
  const forLevel = me?.progress.pointsForLevel != null ? Number(me.progress.pointsForLevel) : null;
  const pct = forLevel && forLevel > 0 ? Math.min(100, Math.round((intoLevel / forLevel) * 100)) : me ? 100 : 0;
  const atTop = !me?.nextLevel;
  const tier = tierStyleForRank(me?.currentLevel.rankOrder ?? 1);

  return (
    <div className="bg-casino-ambient p-4 lg:p-6">
      <h1 className="mb-1 text-xl font-bold text-text-primary">VIP Club</h1>
      <p className="mb-5 text-sm text-text-muted">Earn XP every time you play to climb the ladder and unlock perks.</p>

      {meLoading && <Skeleton className="h-64 w-full rounded-2xl" />}

      {!meLoading && me && (
        <div className="relative mb-8 overflow-hidden rounded-2xl border border-border bg-surface animate-fade-in-up">
          {/* Low-opacity metallic tier wash behind the content, dimmed
              toward the bottom so text stays legible against it. */}
          <div
            className="bg-tier-metal absolute inset-0 opacity-[0.14]"
            style={{ ["--tier" as any]: tier.cssVar, ["--tier-hi" as any]: tier.cssVarHi }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-surface/60 to-surface" />
          <div className="bg-casino-vignette absolute inset-0" />

          <div className="relative z-10 p-6 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">Vaultline VIP</p>
                <h2
                  className={cn("mt-1 text-3xl font-black uppercase tracking-tight sm:text-4xl", tier.text)}
                  style={{ textShadow: `0 0 28px rgb(${tier.cssVarHi} / 0.35)` }}
                >
                  {me.currentLevel.name}
                </h2>
                <p className="mt-1 text-xs font-medium text-text-muted">
                  Rank {me.currentLevel.rankOrder} of {levels?.length ?? 10}
                </p>
              </div>

              <div
                className="bg-tier-metal flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl shadow-card-lift sm:h-20 sm:w-20"
                style={{ ["--tier" as any]: tier.cssVar, ["--tier-hi" as any]: tier.cssVarHi }}
              >
                <Trophy className="h-8 w-8 text-black/70 drop-shadow sm:h-10 sm:w-10" />
              </div>
            </div>

            <div className="mt-6">
              <div className="h-3 w-full overflow-hidden rounded-full bg-surface-raised">
                <div
                  className="h-full rounded-full transition-[width] duration-700 ease-out"
                  style={{
                    width: `${pct}%`,
                    background: `linear-gradient(90deg, rgb(${tier.cssVar}), rgb(${tier.cssVarHi}))`,
                  }}
                />
              </div>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="font-mono text-xs font-semibold text-text-primary">
                  {formatXp(intoLevel)}
                  {forLevel != null && <span className="text-text-muted"> / {formatXp(forLevel)} XP</span>}
                  {atTop && <span className="text-text-muted"> XP · Top level</span>}
                </span>
                {!atTop && <span className={cn("text-sm font-bold", tier.text)}>{pct}%</span>}
              </div>
              <p className="mt-1.5 text-xs text-text-muted">
                {me.nextLevel
                  ? `${formatXp(me.nextLevel.pointsNeeded)} XP until ${me.nextLevel.name}`
                  : "You've reached the top level."}
              </p>
            </div>

            {Array.isArray(me.currentLevel.benefits) && me.currentLevel.benefits.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-2">
                {me.currentLevel.benefits.map((b) => (
                  <Badge key={b} variant="neutral" className={cn("bg-surface-raised/80", tier.borderSoft)}>
                    {b}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {!meLoading && me && me.rewardHistorySummary.totalRewards > 0 && (
        <div className="mb-8">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Recent VIP rewards</p>
          <div className="space-y-1.5 rounded-xl border border-border bg-surface/60 p-4">
            {me.rewardHistorySummary.recent.slice(0, 5).map((r) => (
              <div key={r.id} className="flex items-center justify-between text-xs">
                <span className="text-text-muted">{r.type.replace(/_/g, " ").toLowerCase()}</span>
                <span
                  className={cn(
                    "font-mono font-semibold",
                    r.currency === "GC" ? "text-accent-gc" : "text-accent-sc"
                  )}
                >
                  +{formatCoins(Number(r.amount) * 100)} {r.currency}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">Level ladder</h2>
      <div className="space-y-2">
        {levelsLoading &&
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
        {!levelsLoading &&
          levels?.map((lvl) => {
            const isCurrent = me?.currentLevel.rankOrder === lvl.rankOrder;
            const isPast = !!me && lvl.rankOrder < me.currentLevel.rankOrder;
            const rowTier = tierStyleForRank(lvl.rankOrder);
            return (
              <div
                key={lvl.id}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-xl border border-border bg-surface/60 p-4 transition-colors",
                  isCurrent && cn("bg-surface", rowTier.borderSoft),
                  isPast && "opacity-55"
                )}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn("h-2.5 w-2.5 shrink-0 rounded-full", rowTier.dot)}
                    style={isCurrent ? { boxShadow: `0 0 10px 2px rgb(${rowTier.cssVarHi} / 0.6)` } : undefined}
                  />
                  <div>
                    <p className={cn("text-sm font-semibold", isCurrent ? rowTier.text : "text-text-primary")}>
                      {lvl.rankOrder}. {lvl.name}
                    </p>
                    {Array.isArray(lvl.benefits) && lvl.benefits.length > 0 && (
                      <p className="mt-0.5 text-xs text-text-muted">{lvl.benefits.join(" · ")}</p>
                    )}
                  </div>
                </div>
                {isCurrent && <Badge variant="sc">Current</Badge>}
              </div>
            );
          })}
      </div>
    </div>
  );
}
