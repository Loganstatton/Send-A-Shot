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

interface DailyBonusState {
  streakDay: number;
  claimedToday: boolean;
  nextRewardAmount: number;
  rewards: number[];
  cooldownEndsAt?: string | null;
}

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

  const rewards = data?.rewards ?? [500, 750, 1000, 1500, 2000, 3000, 5000];
  const streakDay = data?.streakDay ?? 1;

  return (
    <div className="mx-auto max-w-2xl p-4 lg:p-6">
      <h1 className="mb-1 text-xl font-bold text-text-primary">Daily Bonus</h1>
      <p className="mb-5 text-sm text-text-muted">Log in every day to grow your streak and earn more Gold Coins.</p>

      <Card>
        <CardContent className="p-6">
          <div className="grid grid-cols-7 gap-2">
            {rewards.map((amount, idx) => {
              const day = idx + 1;
              const isPast = day < streakDay || (day === streakDay && data?.claimedToday);
              const isToday = day === streakDay && !data?.claimedToday;
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
                  <span className="font-mono text-[10px] text-text-primary">{formatCoins(amount)}</span>
                </div>
              );
            })}
          </div>

          <div className="mt-6 text-center">
            {data?.claimedToday ? (
              <p className="text-sm text-text-muted">You've claimed today's bonus — come back tomorrow.</p>
            ) : (
              <Button size="lg" onClick={claim} loading={claiming}>
                Claim Day {streakDay} Bonus
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
