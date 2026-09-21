"use client";

import { useCallback } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { useFetch } from "@/lib/hooks/useFetch";
import { api } from "@/lib/api-client";
import type { VipLevel, VipSummary } from "@/lib/types";
import { Trophy } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export default function VipClubPage() {
  const meFetcher = useCallback(() => api.get<VipSummary>("/vip/me"), []);
  const { data: me, loading: meLoading } = useFetch(meFetcher);

  const levelsFetcher = useCallback(() => api.get<VipLevel[]>("/vip/levels"), []);
  const { data: levels, loading: levelsLoading } = useFetch(levelsFetcher);

  const pct = me && me.progressTarget > 0 ? Math.min(100, Math.round((me.progress / me.progressTarget) * 100)) : 0;

  return (
    <div className="p-4 lg:p-6">
      <h1 className="mb-4 text-xl font-bold text-text-primary">VIP Club</h1>

      {meLoading && <Skeleton className="h-40 w-full rounded-xl" />}

      {!meLoading && me && (
        <Card className="mb-6 border-accent-sc/25 bg-accent-sc/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-accent-sc">
              <Trophy className="h-5 w-5" />
              <span className="text-lg font-bold">{me.levelName}</span>
            </div>
            <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-surface-raised">
              <div className="h-full rounded-full bg-accent-sc" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-2 text-xs text-text-muted">
              {me.nextLevelName ? `${pct}% of the way to ${me.nextLevelName}` : "You've reached the top level."}
            </p>
            {me.benefits?.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {me.benefits.map((b) => (
                  <Badge key={b} variant="sc">
                    {b}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">Level ladder</h2>
      <div className="space-y-2">
        {levelsLoading &&
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
        {!levelsLoading &&
          levels?.map((lvl) => (
            <Card key={lvl.level} className={cn(me?.level === lvl.level && "border-accent-sc/50")}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="text-sm font-semibold text-text-primary">
                    {lvl.level}. {lvl.name}
                  </p>
                  <p className="mt-0.5 text-xs text-text-muted">{lvl.benefits.join(" · ")}</p>
                </div>
                {me?.level === lvl.level && <Badge variant="sc">Current</Badge>}
              </CardContent>
            </Card>
          ))}
      </div>
    </div>
  );
}
