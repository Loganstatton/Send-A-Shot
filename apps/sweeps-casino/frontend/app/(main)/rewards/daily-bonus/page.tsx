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
import { Gift, CheckCircle, Chest, Lock } from "@/components/ui/icons";
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

// Coins used for the claim flourish — purely decorative, staggered flight
// paths toward the top of the card (where the wallet/balance reads live in
// the header, off-page). Reuses coin-shimmer as its base treatment on the
// day tile and layers this on top only for the instant of a claim.
const FLY_COINS = [
  { dx: -34, delay: 0 },
  { dx: -10, delay: 60 },
  { dx: 14, delay: 120 },
  { dx: 38, delay: 40 },
  { dx: 2, delay: 160 },
];

export default function DailyBonusPage() {
  const toast = useToast();
  const fetchBalances = useWalletStore((s) => s.fetchBalances);
  const fetcher = useCallback(() => api.get<DailyBonusState>("/promotions/daily-bonus"), []);
  const { data, loading, refetch } = useFetch(fetcher);
  const [claiming, setClaiming] = useState(false);
  const [justClaimed, setJustClaimed] = useState<{ day: number; label: string } | null>(null);
  const [flying, setFlying] = useState(false);

  useEffect(() => {
    if (!justClaimed) return;
    const t = setTimeout(() => setJustClaimed(null), 2200);
    return () => clearTimeout(t);
  }, [justClaimed]);

  useEffect(() => {
    if (!flying) return;
    const t = setTimeout(() => setFlying(false), 900);
    return () => clearTimeout(t);
  }, [flying]);

  async function claim() {
    setClaiming(true);
    try {
      const claimedDay = streakDay;
      await api.post("/promotions/daily-bonus/claim", {}, { idempotent: true });
      const label = data?.reward?.length
        ? data.reward.map((g) => `+${formatCoins(Number(g.amount) * 100)} ${g.currency}`).join(" · ")
        : "Claimed!";
      setJustClaimed({ day: claimedDay, label });
      setFlying(true);
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
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  const streakDay = ((data?.day ?? 1) - 1) % 7 + 1;
  const claimedToday = !data?.claimableNow;
  const nextRewardAmount = !claimedToday ? SCHEDULE_GC[streakDay - 1] : SCHEDULE_GC[streakDay % 7];
  const nextDay = claimedToday ? (streakDay % 7) + 1 : streakDay;
  const nextIsMystery = nextDay === 7;

  return (
    <div className="bg-casino-ambient mx-auto max-w-2xl p-4 lg:p-6">
      <h1 className="mb-1 text-xl font-bold text-text-primary">Daily Bonus</h1>
      <p className="mb-5 text-sm text-text-muted">Log in every day to grow your streak and earn more Gold Coins.</p>

      <div className="relative overflow-hidden rounded-2xl border border-accent-gc/25 bg-surface shadow-card-lift">
        <div className="bg-casino-vignette absolute inset-0" />
        <div
          className="absolute inset-0 opacity-25"
          style={{
            background:
              "radial-gradient(70% 60% at 50% 0%, rgb(var(--color-accent-gc) / 0.28), transparent 65%)",
          }}
        />

        <div className="relative z-10 p-4 sm:p-6">
          {/* Hero streak readout */}
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-accent-gc">
                <span aria-hidden>🔥</span> Streak
              </p>
              <p className="mt-0.5 text-2xl font-black uppercase tracking-tight text-text-primary sm:text-3xl">
                Day {streakDay} <span className="text-text-muted">of 7</span>
              </p>
            </div>
            {claimedToday ? (
              <span className="flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-[11px] font-semibold text-success">
                <CheckCircle className="h-3.5 w-3.5" /> Claimed
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-full border border-accent-gc/40 bg-accent-gc/10 px-2.5 py-1 text-[11px] font-semibold text-accent-gc">
                Ready
              </span>
            )}
          </div>

          {/* 7-day calendar */}
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7 sm:gap-2.5">
            {SCHEDULE_GC.map((amount, idx) => {
              const day = idx + 1;
              const isMystery = day === 7;
              const isPast = day < streakDay || (day === streakDay && claimedToday);
              const isToday = day === streakDay && !claimedToday;
              const isLocked = !isPast && !isToday;
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
                    "relative flex flex-col items-center gap-1 rounded-xl border p-1.5 text-center transition-all duration-200 sm:p-2.5",
                    isPast && "border-success/30 bg-success/10 coin-shimmer",
                    isToday && "border-accent-gc bg-accent-gc/10 shadow-glow-gc scale-105",
                    isLocked && "border-border bg-surface-raised opacity-50",
                    isMystery && !isPast && "border-accent-gc/40",
                    justPopped && "animate-pulse-glow"
                  )}
                >
                  {justPopped && flying && (
                    <div className="pointer-events-none absolute inset-0 overflow-visible">
                      {FLY_COINS.map((c, i) => (
                        <span
                          key={i}
                          className="daily-bonus-fly-coin absolute left-1/2 top-1/2 text-[10px] sm:text-xs"
                          style={{ ["--dx" as any]: `${c.dx}px`, animationDelay: `${c.delay}ms` }}
                          aria-hidden
                        >
                          🪙
                        </span>
                      ))}
                    </div>
                  )}
                  <span className={cn("inline-flex", justPopped && "animate-pop")}>
                    {isMystery && !isPast ? (
                      <Chest className={cn("h-4 w-4 sm:h-5 sm:w-5", isToday ? "text-accent-gc" : "text-text-muted")} />
                    ) : isLocked ? (
                      <Lock className="h-3.5 w-3.5 text-text-muted/70 sm:h-4 sm:w-4" />
                    ) : (
                      <Gift className={cn("h-4 w-4 sm:h-5 sm:w-5", isToday ? "text-accent-gc" : "text-success")} />
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

          {/* Claim / status footer */}
          <div className="mt-6 flex flex-col items-center gap-3 border-t border-border/60 pt-5 text-center">
            {justClaimed ? (
              <p className="animate-scale-in text-sm font-semibold text-success">{justClaimed.label} added to your balance</p>
            ) : claimedToday ? (
              <>
                <p className="text-sm text-text-muted">
                  You&apos;ve claimed today&apos;s bonus — check back in {formatRemaining(data?.hoursRemaining ?? 0)}.
                </p>
                <p className="text-xs text-text-muted">
                  Next up: {nextIsMystery ? (
                    <span className="font-semibold text-accent-gc">Day {nextDay} Mystery Chest</span>
                  ) : (
                    <span className="font-semibold text-accent-gc">
                      Day {nextDay} · {formatCoins(nextRewardAmount * 100)} GC
                    </span>
                  )}
                </p>
              </>
            ) : (
              <Button size="lg" className="coin-shimmer w-full sm:w-auto" onClick={claim} loading={claiming}>
                <Gift className="h-4 w-4" />
                Claim Day {streakDay} Bonus
                {data?.reward?.length
                  ? ` · ${data.reward.map((g) => `${formatCoins(Number(g.amount) * 100)} ${g.currency}`).join(" + ")}`
                  : ""}
              </Button>
            )}
          </div>
        </div>
      </div>

      <style jsx>{`
        .daily-bonus-fly-coin {
          transform: translate(-50%, -50%);
          animation: daily-bonus-coin-fly 700ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        @keyframes daily-bonus-coin-fly {
          0% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.6);
          }
          20% {
            opacity: 1;
          }
          100% {
            opacity: 0;
            transform: translate(calc(-50% + var(--dx)), -140%) scale(0.9);
          }
        }
      `}</style>
    </div>
  );
}
