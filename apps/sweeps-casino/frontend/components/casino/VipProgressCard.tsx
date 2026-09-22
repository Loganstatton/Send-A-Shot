"use client";

import Link from "next/link";
import { useCallback } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { useFetch } from "@/lib/hooks/useFetch";
import { api } from "@/lib/api-client";
import type { VipSummary } from "@/lib/types";
import { Trophy, ArrowRight } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { tierStyleForRank } from "@/lib/vip-tiers";

/** Thin premium VIP banner — standalone-renderable with zero props, used
 * as a home-lobby teaser. Tapping navigates to the full VIP Club page. */
export function VipProgressCard() {
  const fetcher = useCallback(() => api.get<VipSummary>("/vip/me"), []);
  const { data, loading } = useFetch(fetcher);

  if (loading) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3.5 sm:p-4">
        <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-2 w-full rounded-full" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const intoLevel = Number(data.progress.pointsIntoLevel);
  const forLevel = data.progress.pointsForLevel != null ? Number(data.progress.pointsForLevel) : null;
  const pct = forLevel && forLevel > 0 ? Math.min(100, Math.round((intoLevel / forLevel) * 100)) : 100;
  const tier = tierStyleForRank(data.currentLevel.rankOrder);
  const tierVars = { ["--tier" as any]: tier.cssVar, ["--tier-hi" as any]: tier.cssVarHi };

  return (
    <Link href="/rewards/vip-club" className="block">
      <div
        className={cn(
          "group relative flex items-center gap-3 overflow-hidden rounded-xl border bg-surface p-3.5 shadow-sm transition-all duration-300 ease-premium hover:-translate-y-0.5 hover:shadow-card-lift sm:p-4",
          tier.borderSoft
        )}
      >
        {/* Thin metallic accent strip along the top — this tier's material,
            at full strength, kept out of the text-contrast path. */}
        <div className="bg-tier-metal absolute inset-x-0 top-0 h-1" style={tierVars} />

        <div
          className="bg-tier-metal flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm"
          style={tierVars}
        >
          <Trophy className="h-5 w-5 text-black/70" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-text-muted">Your VIP Journey</p>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm font-black uppercase tracking-wide">
            <span className={tier.text}>{data.currentLevel.name}</span>
            {data.nextLevel && (
              <>
                <ArrowRight className="h-3 w-3 shrink-0 text-text-muted" />
                <span className="truncate text-text-muted">{data.nextLevel.name}</span>
              </>
            )}
          </p>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-raised">
            <div
              className="h-full rounded-full transition-[width] duration-700 ease-out"
              style={{
                width: `${pct}%`,
                background: `linear-gradient(90deg, rgb(${tier.cssVar}), rgb(${tier.cssVarHi}))`,
              }}
            />
          </div>
        </div>

        <div className="shrink-0 text-right">
          <p className={cn("text-base font-black leading-none", tier.text)}>{pct}%</p>
          <span className="mt-1 block text-[10px] font-bold uppercase tracking-wide text-text-muted group-hover:text-text-primary">
            View VIP
          </span>
        </div>
      </div>
    </Link>
  );
}
