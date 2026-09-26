"use client";

import Link from "next/link";
import { useCallback } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { useFetch } from "@/lib/hooks/useFetch";
import { api } from "@/lib/api-client";
import { CheckCircle } from "@/components/ui/icons";
import { cn, formatCoins } from "@/lib/utils";

// Matches backend PromotionsService.getDailyBonusState() — see
// backend/src/modules/promotions/promotions.service.ts. Same shape the
// full daily-bonus page reads; this teaser fetches it independently since
// it's rendered standalone (home lobby) with zero required props.
interface DailyBonusState {
  promotionId: string;
  day: number;
  claimableNow: boolean;
  hoursRemaining: number;
  reward: Array<{ currency: "GC" | "SC"; amount: string }>;
  cooldownHours: number;
}

/** Compact home teaser — tapping/clicking always navigates to the full
 * daily-bonus page; actual claiming only happens there. */
export function DailyRewardCard() {
  const fetcher = useCallback(() => api.get<DailyBonusState>("/promotions/daily-bonus"), []);
  const { data, loading, error } = useFetch(fetcher);

  if (loading) {
    return (
      <Card className="border-accent-gc/25 bg-accent-gc/5">
        <CardContent className="flex items-center gap-4 p-4">
          <Skeleton className="h-11 w-11 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3 w-40" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Best-effort static fallback if the fetch failed — still a useful,
  // navigable teaser, just without live streak/reward numbers.
  if (error || !data) {
    return (
      <Link href="/rewards/daily-bonus" className="block">
        <Card className="border-accent-gc/25 bg-accent-gc/5 transition-colors hover:shadow-glow-gc">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent-gc/15 text-lg">
              🔥
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-text-primary">Daily Bonus</p>
              <p className="text-xs text-text-muted">Come back every day to grow your streak.</p>
            </div>
          </CardContent>
        </Card>
      </Link>
    );
  }

  const streakDay = ((data.day ?? 1) - 1) % 7 + 1;
  const claimedToday = !data.claimableNow;
  const rewardLabel = data.reward?.length
    ? data.reward.map((g) => `${formatCoins(Number(g.amount) * 100)} ${g.currency}`).join(" + ")
    : null;

  return (
    <Link href="/rewards/daily-bonus" className="block">
      <Card className="group relative overflow-hidden border-accent-gc/25 bg-accent-gc/5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-glow-gc">
        <div className="bg-casino-vignette absolute inset-0 opacity-40" />
        <CardContent className="relative flex items-center gap-4 p-4">
          <div
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent-gc/15 text-lg",
              !claimedToday && "coin-shimmer shadow-glow-gc"
            )}
          >
            🔥
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold uppercase tracking-wide text-accent-gc">Day {streakDay} Streak</p>
            <p className="mt-0.5 truncate text-xs text-text-muted">
              {claimedToday
                ? "Claimed — come back tomorrow"
                : rewardLabel
                  ? `Today's reward: ${rewardLabel}`
                  : "Today's reward is ready"}
            </p>
          </div>
          {claimedToday ? (
            <span className="flex shrink-0 items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-[11px] font-semibold text-success">
              <CheckCircle className="h-3.5 w-3.5" /> Done
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md bg-accent-gc px-3 py-1.5 text-xs font-semibold text-bg shadow-sm transition-all group-hover:shadow-glow-gc">
              Claim
            </span>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
