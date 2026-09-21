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

  const pct = data.progressTarget > 0 ? Math.min(100, Math.round((data.progress / data.progressTarget) * 100)) : 0;

  return (
    <Link href="/rewards/vip-club">
      <Card className="border-accent-sc/25 bg-accent-sc/5 transition-colors hover:border-accent-sc/50">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-accent-sc">
            <Trophy className="h-4 w-4" />
            VIP {data.levelName}
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-raised">
            <div className="h-full rounded-full bg-accent-sc transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1.5 text-[11px] text-text-muted">
            {data.nextLevelName ? `${pct}% to ${data.nextLevelName}` : "Max level reached"}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
