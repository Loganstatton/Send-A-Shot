"use client";

import { useCallback } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { useFetch } from "@/lib/hooks/useFetch";
import { api } from "@/lib/api-client";
import type { VipLevel, VipSummary } from "@/lib/types";
import { Trophy, CheckCircle, Lock, Star } from "@/components/ui/icons";
import { cn, formatCoins } from "@/lib/utils";
import { tierStyleForRank, type TierKey } from "@/lib/vip-tiers";

function formatXp(value: string | number) {
  return Math.round(Number(value)).toLocaleString();
}

// The 7 CSS "tier metal" materials, each represented by one ladder rank
// (Platinum's 4 sub-ranks all collapse onto a single roadmap tile — see
// lib/vip-tiers.ts's tierKeyForRank). Purely a visual roadmap; the detailed
// rank-by-rank ladder below still reflects the real 10-rank backend list.
const TIER_ROADMAP: Array<{ key: TierKey; rank: number; label: string }> = [
  { key: "starter", rank: 1, label: "Starter" },
  { key: "bronze", rank: 2, label: "Bronze" },
  { key: "silver", rank: 3, label: "Silver" },
  { key: "gold", rank: 4, label: "Gold" },
  { key: "platinum", rank: 5, label: "Platinum" },
  { key: "diamond", rank: 9, label: "Diamond" },
  { key: "elite", rank: 10, label: "Elite" },
];

export default function VipClubPage() {
  const meFetcher = useCallback(() => api.get<VipSummary>("/vip/me"), []);
  const { data: me, loading: meLoading } = useFetch(meFetcher);

  const levelsFetcher = useCallback(() => api.get<VipLevel[]>("/vip/levels"), []);
  const { data: levels, loading: levelsLoading } = useFetch(levelsFetcher);

  const intoLevel = Number(me?.progress.pointsIntoLevel ?? 0);
  const forLevel = me?.progress.pointsForLevel != null ? Number(me.progress.pointsForLevel) : null;
  const pct = forLevel && forLevel > 0 ? Math.min(100, Math.round((intoLevel / forLevel) * 100)) : me ? 100 : 0;
  const atTop = !me?.nextLevel;
  const rankOrder = me?.currentLevel.rankOrder ?? 1;
  const tier = tierStyleForRank(rankOrder);
  const tierVars = { ["--tier" as any]: tier.cssVar, ["--tier-hi" as any]: tier.cssVarHi };

  const currentRoadmapIdx = TIER_ROADMAP.findIndex((t) => t.rank === (rankOrder <= 4 ? rankOrder : rankOrder <= 8 ? 5 : rankOrder));

  return (
    <div className="bg-casino-ambient p-4 lg:p-6">
      <h1 className="mb-1 text-xl font-bold text-text-primary">VIP Club</h1>
      <p className="mb-5 text-sm text-text-muted">Earn XP every time you play to climb the ladder and unlock perks.</p>

      {meLoading && <Skeleton className="h-72 w-full rounded-2xl" />}

      {!meLoading && me && (
        <div className="relative mb-8 overflow-hidden rounded-2xl border border-border bg-surface animate-fade-in-up">
          {/* Low-opacity metallic tier wash behind the content, dimmed
              toward the bottom so text stays legible against it. */}
          <div className="bg-tier-metal absolute inset-0 opacity-[0.14]" style={tierVars} />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-surface/60 to-surface" />
          <div className="bg-casino-vignette absolute inset-0" />

          <div className="relative z-10 p-6 sm:p-8">
            <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
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
                <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  {me.nextLevel ? (
                    <>
                      Next: <span className={tier.text}>{me.nextLevel.name}</span>
                    </>
                  ) : (
                    "Top level reached"
                  )}
                </p>
              </div>

              {/* Progress ring — pure CSS conic-gradient, no chart lib. */}
              <div className="relative h-28 w-28 shrink-0 sm:h-32 sm:w-32">
                <div
                  className="absolute inset-0 rounded-full transition-[background] duration-700"
                  style={{
                    background: `conic-gradient(rgb(${tier.cssVarHi}) ${pct}%, rgb(var(--color-surface-raised)) ${pct}% 100%)`,
                  }}
                />
                <div
                  className="bg-tier-metal absolute inset-[5px] rounded-full opacity-90"
                  style={tierVars}
                />
                <div className="absolute inset-[10px] flex flex-col items-center justify-center rounded-full bg-surface shadow-card-lift">
                  <Trophy className={cn("h-6 w-6", tier.text)} />
                  <span className={cn("mt-1 text-base font-black leading-none", tier.text)}>{pct}%</span>
                </div>
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
          </div>
        </div>
      )}

      {/* Your Benefits — only real backend data (currentLevel.benefits),
          never fabricated perks. */}
      {!meLoading && me && Array.isArray(me.currentLevel.benefits) && me.currentLevel.benefits.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">Your benefits</h2>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {me.currentLevel.benefits.map((b) => (
              <div
                key={b}
                className={cn(
                  "flex items-center gap-3 rounded-xl border bg-surface/60 p-3.5",
                  tier.borderSoft
                )}
              >
                <div className="bg-tier-metal flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={tierVars}>
                  <Star className="h-4 w-4 text-black/70" />
                </div>
                <span className="text-sm font-medium text-text-primary">{b}</span>
              </div>
            ))}
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

      {/* Visual tier roadmap — the 7 CSS tier materials, Starter -> Elite. */}
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">Tier roadmap</h2>
      <div className="no-scrollbar mb-8 flex snap-x gap-3 overflow-x-auto pb-1 pt-3">
        {TIER_ROADMAP.map((t, idx) => {
          const style = tierStyleForRank(t.rank);
          const styleVars = { ["--tier" as any]: style.cssVar, ["--tier-hi" as any]: style.cssVarHi };
          const isCurrent = !meLoading && idx === currentRoadmapIdx;
          const isReached = !meLoading && me != null && idx <= currentRoadmapIdx;
          const isLocked = !isReached;
          return (
            <div
              key={t.key}
              className={cn(
                "relative flex w-24 shrink-0 snap-start flex-col items-center gap-2 rounded-xl border p-3 text-center transition-transform",
                isCurrent ? cn("border-2 scale-105 shadow-card-lift", style.borderSoft) : "border-border bg-surface/60",
                isLocked && "opacity-55"
              )}
            >
              <div
                className={cn("bg-tier-metal relative flex h-12 w-12 items-center justify-center rounded-xl", isCurrent && "shadow-glow-gc")}
                style={styleVars}
              >
                {isLocked ? (
                  <Lock className="h-5 w-5 text-black/60" />
                ) : (
                  <Trophy className="h-5 w-5 text-black/70" />
                )}
              </div>
              <span className={cn("text-xs font-bold uppercase tracking-wide", isCurrent ? style.text : "text-text-primary")}>
                {t.label}
              </span>
              {isCurrent && (
                <Badge variant="sc" className="absolute -top-2 right-1">
                  You
                </Badge>
              )}
              {isReached && !isCurrent && <CheckCircle className="h-3.5 w-3.5 text-success" />}
            </div>
          );
        })}
      </div>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">Full level ladder</h2>
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
