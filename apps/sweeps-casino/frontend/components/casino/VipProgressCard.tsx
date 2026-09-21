"use client";

import Link from "next/link";
import { useCallback } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { useFetch } from "@/lib/hooks/useFetch";
import { api } from "@/lib/api-client";
import type { VipSummary } from "@/lib/types";
import { Trophy } from "@/components/ui/icons";

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

  return (
    <Link href="/rewards/vip-club">
      <Card className="border-accent-sc/25 bg-accent-sc/5 transition-colors hover:border-accent-sc/50">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-accent-sc">
            <Trophy className="h-4 w-4" />
            VIP {data.currentLevel.name}
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-raised">
            <div
              className="h-full rounded-full bg-accent-sc transition-[width] duration-700 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-text-muted">
            {data.nextLevel ? `${pct}% to ${data.nextLevel.name}` : "Top level reached"}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
