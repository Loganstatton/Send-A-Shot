"use client";

import { useCallback } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { useFetch } from "@/lib/hooks/useFetch";
import { api } from "@/lib/api-client";
import type { VipLevel, VipSummary } from "@/lib/types";
import { Trophy } from "@/components/ui/icons";
import { cn, formatCoins } from "@/lib/utils";

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

  return (
    <div className="p-4 lg:p-6">
      <h1 className="mb-1 text-xl font-bold text-text-primary">VIP Club</h1>
      <p className="mb-4 text-sm text-text-muted">Earn XP every time you play to climb the ladder and unlock perks.</p>

      {meLoading && <Skeleton className="h-44 w-full rounded-xl" />}

      {!meLoading && me && (
        <Card className="mb-6 overflow-hidden border-accent-sc/25 bg-accent-sc/5">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-accent-sc">
                <Trophy className="h-5 w-5" />
                <span className="text-lg font-bold text-text-primary">{me.currentLevel.name}</span>
              </div>
              <span className="text-xs font-medium text-text-muted">Rank {me.currentLevel.rankOrder}</span>
            </div>

            <div className="mt-5">
              <div className="mb-1.5 flex items-baseline justify-between text-xs">
                <span className="font-mono font-semibold text-text-primary">
                  {formatXp(intoLevel)}
                  {forLevel != null && <span className="text-text-muted"> / {formatXp(forLevel)} XP</span>}
                  {atTop && <span className="text-text-muted"> XP · Top level</span>}
                </span>
                {!atTop && <span className="text-text-muted">{pct}%</span>}
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-raised">
                <div
                  className="h-full rounded-full bg-accent-sc transition-[width] duration-700 ease-out"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-text-muted">
                {me.nextLevel
                  ? `${formatXp(me.nextLevel.pointsNeeded)} XP until ${me.nextLevel.name}`
                  : "You've reached the top level."}
              </p>
            </div>

            {Array.isArray(me.currentLevel.benefits) && me.currentLevel.benefits.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {me.currentLevel.benefits.map((b) => (
                  <Badge key={b} variant="sc">
                    {b}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!meLoading && me && me.rewardHistorySummary.totalRewards > 0 && (
        <Card className="mb-6">
          <CardContent className="p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Recent VIP rewards</p>
            <div className="space-y-1.5">
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
          </CardContent>
        </Card>
      )}

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">Level ladder</h2>
      <div className="space-y-2">
        {levelsLoading &&
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
        {!levelsLoading &&
          levels?.map((lvl) => {
            const isCurrent = me?.currentLevel.rankOrder === lvl.rankOrder;
            const isPast = !!me && lvl.rankOrder < me.currentLevel.rankOrder;
            return (
              <Card
                key={lvl.id}
                className={cn(
                  "transition-colors",
                  isCurrent && "border-accent-sc/50 bg-accent-sc/5",
                  isPast && "opacity-60"
                )}
              >
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-sm font-semibold text-text-primary">
                      {lvl.rankOrder}. {lvl.name}
                    </p>
                    {Array.isArray(lvl.benefits) && lvl.benefits.length > 0 && (
                      <p className="mt-0.5 text-xs text-text-muted">{lvl.benefits.join(" · ")}</p>
                    )}
                  </div>
                  {isCurrent && <Badge variant="sc">Current</Badge>}
                </CardContent>
              </Card>
            );
          })}
      </div>
    </div>
  );
}
