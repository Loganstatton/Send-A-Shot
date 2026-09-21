"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useFetch } from "@/lib/hooks/useFetch";
import { api } from "@/lib/api-client";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useToast } from "@/components/layout/Toast";
import { useWalletStore } from "@/lib/stores/wallet-store";
import { Gift, CheckCircle, Chest } from "@/components/ui/icons";
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
const SCHEDULE_GC = [500, 750, 1000, 1500, 2000, 3000, 3500];

/** "13.7 hours remaining" -> "13h 42m". Static, computed on load — no
 * live-ticking clock (not worth the added complexity/risk for this sprint). */
function formatRemaining(hoursRemaining: number): string {
  let h = Math.floor(Math.max(0, hoursRemaining));
  let m = Math.round((Math.max(0, hoursRemaining) - h) * 60);
  if (m === 60) {
    h += 1;
    m = 0;
  }
  if (h === 0 && m === 0) return "just a few minutes";
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default function DailyBonusPage() {
  const toast = useToast();
  const fetchBalances = useWalletStore((s) => s.fetchBalances);
  const fetcher = useCallback(() => api.get<DailyBonusState>("/promotions/daily-bonus"), []);
  const { data, loading, refetch } = useFetch(fetcher);
  const [claiming, setClaiming] = useState(false);
  const [justClaimed, setJustClaimed] = useState<{ day: number; label: string } | null>(null);

  useEffect(() => {
    if (!justClaimed) return;
    const t = setTimeout(() => setJustClaimed(null), 2200);
    return () => clearTimeout(t);
  }, [justClaimed]);

  async function claim() {
    setClaiming(true);
    try {
      const claimedDay = streakDay;
      await api.post("/promotions/daily-bonus/claim", {}, { idempotent: true });
      const label = data?.reward?.length
        ? data.reward.map((g) => `+${formatCoins(Number(g.amount) * 100)} ${g.currency}`).join(" · ")
        : "Claimed!";
      setJustClaimed({ day: claimedDay, label });
      toast.push("Daily bonus claimed!", "success");
      fetchBalances();
      refetch();
    } catch (err) {
      toast.push(friendlyErrorMessage(err, "Could not claim today's bonus."), "danger");
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
        <CardContent className="p-4 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Your streak</p>
              <p className="text-lg font-bold text-text-primary">Day {streakDay} of 7</p>
            </div>
            {claimedToday && (
              <span className="flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-[11px] font-semibold text-success">
                <CheckCircle className="h-3.5 w-3.5" /> Claimed
              </span>
            )}
          </div>

          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {SCHEDULE_GC.map((amount, idx) => {
              const day = idx + 1;
              const isMystery = day === 7;
              const isPast = day < streakDay || (day === streakDay && claimedToday);
              const isToday = day === streakDay && !claimedToday;
              const justPopped = justClaimed?.day === day;
              // Day 7 is a "Mystery Chest" reveal — the amount is real and
              // fixed server-side (true per-claim randomization would be a
              // backend resolveReward() change, out of scope here), but we
              // don't show the number up front so it reads as a surprise.
              // The claim button and post-claim flourish below both source
              // the real amount from the API response, never this constant,
              // so the reveal is never actually wrong once it's their day.
              const revealAmount = !isMystery || isPast || isToday;
              return (
                <div
                  key={day}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg border p-1.5 text-center transition-all duration-200 sm:p-2",
                    isPast && "border-success/30 bg-success/10 coin-shimmer",
                    isToday && "border-accent-gc bg-accent-gc/10 shadow-glow-gc",
                    !isPast && !isToday && "border-border bg-surface-raised opacity-60",
                    isMystery && !isPast && "border-accent-gc/40",
                    justPopped && "animate-pulse-glow"
                  )}
                >
                  <span className={cn("inline-flex", justPopped && "animate-pop")}>
                    {isMystery && !isPast ? (
                      <Chest className={cn("h-3.5 w-3.5 sm:h-4 sm:w-4", isToday ? "text-accent-gc" : "text-text-muted")} />
                    ) : (
                      <Gift className={cn("h-3.5 w-3.5 sm:h-4 sm:w-4", isToday ? "text-accent-gc" : "text-text-muted")} />
                    )}
                  </span>
                  <span className="text-[9px] font-semibold text-text-muted sm:text-[10px]">
                    {isMystery ? "Mystery" : `Day ${day}`}
                  </span>
                  <span
                    className={cn(
                      "font-mono text-[9px] sm:text-[10px]",
                      isMystery && !revealAmount ? "text-accent-gc/70" : "text-text-primary"
                    )}
                  >
                    {revealAmount ? formatCoins(amount * 100) : "Chest"}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-6 text-center">
            {justClaimed ? (
              <p className="animate-scale-in text-sm font-semibold text-success">{justClaimed.label} added to your balance</p>
            ) : claimedToday ? (
              <p className="text-sm text-text-muted">
                You&apos;ve claimed today&apos;s bonus — check back in {formatRemaining(data?.hoursRemaining ?? 0)}.
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
