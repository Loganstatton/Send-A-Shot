"use client";

import { useCallback, useState } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useFetch } from "@/lib/hooks/useFetch";
import { api, ApiError } from "@/lib/api-client";
import { useToast } from "@/components/layout/Toast";
import { useWalletStore } from "@/lib/stores/wallet-store";
import { Gift } from "@/components/ui/icons";
import { cn, formatCoins } from "@/lib/utils";

// Matches backend PromotionsService.getDailyBonusState() — see
// backend/src/modules/promotions/promotions.service.ts.
interface DailyBonusState {
  promotionId: string;
  day: number;
  claimableNow: boolean;
  hoursRemaining: number;
  reward: Array<{ currency: "GC" | "SC"; amount: string }>;
  cooldownHours: number;
}

// Mirrors the 7-day schedule seeded in backend/prisma/seed.ts
// (seedDailyBonusPromotion) purely for the visual ladder — the actual
// amount credited always comes from the backend's own resolution.
const SCHEDULE_GC = [25, 35, 50, 75, 100, 150, 250];

export default function DailyBonusPage() {
  const toast = useToast();
  const fetchBalances = useWalletStore((s) => s.fetchBalances);
  const fetcher = useCallback(() => api.get<DailyBonusState>("/promotions/daily-bonus"), []);
  const { data, loading, refetch } = useFetch(fetcher);
  const [claiming, setClaiming] = useState(false);

  async function claim() {
    setClaiming(true);
    try {
      await api.post("/promotions/daily-bonus/claim", {}, { idempotent: true });
      toast.push("Daily bonus claimed!", "success");
      fetchBalances();
      refetch();
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "Could not claim today's bonus.", "danger");
    } finally {
      setClaiming(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl p-4 lg:p-6">
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  }

  const streakDay = ((data?.day ?? 1) - 1) % 7 + 1;
  const claimedToday = !data?.claimableNow;

  return (
    <div className="mx-auto max-w-2xl p-4 lg:p-6">
      <h1 className="mb-1 text-xl font-bold text-text-primary">Daily Bonus</h1>
      <p className="mb-5 text-sm text-text-muted">Log in every day to grow your streak and earn more Gold Coins.</p>

      <Card>
        <CardContent className="p-6">
          <div className="grid grid-cols-7 gap-2">
            {SCHEDULE_GC.map((amount, idx) => {
              const day = idx + 1;
              const isPast = day < streakDay || (day === streakDay && claimedToday);
              const isToday = day === streakDay && !claimedToday;
              return (
                <div
                  key={day}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg border p-2 text-center",
                    isPast && "border-success/30 bg-success/10",
                    isToday && "border-accent-gc bg-accent-gc/10 shadow-glow-gc",
                    !isPast && !isToday && "border-border bg-surface-raised opacity-60"
                  )}
                >
                  <Gift className={cn("h-4 w-4", isToday ? "text-accent-gc" : "text-text-muted")} />
                  <span className="text-[10px] font-semibold text-text-muted">Day {day}</span>
                  <span className="font-mono text-[10px] text-text-primary">{formatCoins(amount * 100)}</span>
                </div>
              );
            })}
          </div>

          <div className="mt-6 text-center">
            {claimedToday ? (
              <p className="text-sm text-text-muted">
                You&apos;ve claimed today&apos;s bonus — check back in {Math.max(1, Math.round(data?.hoursRemaining ?? 0))}h.
              </p>
            ) : (
              <Button size="lg" onClick={claim} loading={claiming}>
                Claim Day {streakDay} Bonus
                {data?.reward?.length
                  ? ` · ${data.reward.map((g) => `${formatCoins(Number(g.amount) * 100)} ${g.currency}`).join(" + ")}`
                  : ""}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
