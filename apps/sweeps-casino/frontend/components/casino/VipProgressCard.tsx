"use client";

import Link from "next/link";
import { useCallback } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { useFetch } from "@/lib/hooks/useFetch";
import { api } from "@/lib/api-client";
import type { VipSummary } from "@/lib/types";
import { Trophy } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { tierStyleForRank } from "@/lib/vip-tiers";

export function VipProgressCard() {
  const fetcher = useCallback(() => api.get<VipSummary>("/vip/me"), []);
  const { data, loading } = useFetch(fetcher);

  if (loading) {
    return (
      <Card>
        <CardContent className="p-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-3 h-2 w-full rounded-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const intoLevel = Number(data.progress.pointsIntoLevel);
  const forLevel = data.progress.pointsForLevel != null ? Number(data.progress.pointsForLevel) : null;
  const pct = forLevel && forLevel > 0 ? Math.min(100, Math.round((intoLevel / forLevel) * 100)) : 100;
  const tier = tierStyleForRank(data.currentLevel.rankOrder);

  return (
    <Link href="/rewards/vip-club">
      <Card
        className={cn(
          "relative overflow-hidden border-border bg-surface transition-colors hover:shadow-card-lift",
          tier.borderSoft
        )}
      >
        <CardContent className="relative flex items-center gap-3 p-4">
          <div
            className="bg-tier-metal flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm"
            style={{ ["--tier" as any]: tier.cssVar, ["--tier-hi" as any]: tier.cssVarHi }}
          >
            <Trophy className="h-5 w-5 text-black/70" />
          </div>
          <div className="min-w-0 flex-1">
            <div className={cn("text-sm font-bold uppercase tracking-wide", tier.text)}>
              {data.currentLevel.name}
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-surface-raised">
              <div
                className="h-full rounded-full transition-[width] duration-700 ease-out"
                style={{
                  width: `${pct}%`,
                  background: `linear-gradient(90deg, rgb(${tier.cssVar}), rgb(${tier.cssVarHi}))`,
                }}
              />
            </div>
            <p className="mt-1 text-[11px] text-text-muted">
              {data.nextLevel ? `${pct}% to ${data.nextLevel.name}` : "Top level reached"}
            </p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
