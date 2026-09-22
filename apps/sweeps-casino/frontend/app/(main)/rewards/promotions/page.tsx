"use client";

import { useCallback, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { useFetch } from "@/lib/hooks/useFetch";
import { api } from "@/lib/api-client";
import { friendlyErrorMessage } from "@/lib/error-messages";
import type { Promotion, PromotionClaim, PromotionType } from "@/lib/types";
import { useToast } from "@/components/layout/Toast";
import { useWalletStore } from "@/lib/stores/wallet-store";
import { PromoCard, ComingSoonPromoCard } from "@/components/casino/PromoCard";
import { Gift } from "@/components/ui/icons";

// Roadmap concepts with no live backend promotion behind them yet — shown
// as clearly-disabled "Coming Soon" cards so the page still reads as a full
// promo wall without fabricating claimable rewards. Never given an amount,
// a claim handler, or "active" styling. Keep in sync with spec item 19.
const COMING_SOON: Array<{ title: string; description: string; type: PromotionType; seed: string }> = [
  {
    title: "VIP Rewards",
    description: "Extra perks and bonus drops exclusively for VIP Club members, tied to your tier.",
    type: "MANUAL",
    seed: "coming-soon-vip-rewards",
  },
  {
    title: "Vaultline Originals Challenge",
    description: "Complete objectives across our Originals games for bonus rewards.",
    type: "CHALLENGE",
    seed: "coming-soon-originals-challenge",
  },
  {
    title: "Weekly Race",
    description: "Climb the weekly leaderboard for a shot at bonus prizes.",
    type: "WEEKLY",
    seed: "coming-soon-weekly-race",
  },
  {
    title: "New Player Reward",
    description: "A welcome bonus for brand-new players, available once at signup.",
    type: "SIGNUP",
    seed: "coming-soon-new-player",
  },
  {
    title: "Monthly Draw",
    description: "A monthly prize draw open to eligible players.",
    type: "MONTHLY",
    seed: "coming-soon-monthly-draw",
  },
];

export default function PromotionsPage() {
  const toast = useToast();
  const fetchBalances = useWalletStore((s) => s.fetchBalances);
  const fetcher = useCallback(() => api.get<Promotion[]>("/promotions?status=active"), []);
  const { data, loading, refetch } = useFetch(fetcher);

  // Best-effort "already claimed" state. GET /promotions doesn't carry a
  // per-user claimed flag, so we cross-reference GET /promotions/claims
  // (PromotionsController.listClaims) by promotionId. A card is shown as
  // "Claimed" only once claimLimitPerUser is actually reached — unlimited
  // (null) promotions stay claimable, matching the server's own rule.
  const claimsFetcher = useCallback(() => api.get<PromotionClaim[]>("/promotions/claims"), []);
  const { data: claims } = useFetch(claimsFetcher);
  const claimCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of claims ?? []) {
      counts.set(c.promotionId, (counts.get(c.promotionId) ?? 0) + 1);
    }
    return counts;
  }, [claims]);

  const [claiming, setClaiming] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);

  async function claim(id: string) {
    setClaiming(id);
    try {
      await api.post(`/promotions/${id}/claim`, {}, { idempotent: true });
      toast.push("Promotion claimed.", "success");
      fetchBalances();
      refetch();
    } catch (err) {
      toast.push(friendlyErrorMessage(err, "Could not claim this promotion."), "danger");
    } finally {
      setClaiming(null);
    }
  }

  async function redeemCode(e: React.FormEvent) {
    e.preventDefault();
    setRedeeming(true);
    try {
      await api.post("/promotions/codes/redeem", { code }, { idempotent: true });
      toast.push("Code redeemed.", "success");
      setCode("");
      fetchBalances();
      refetch();
    } catch (err) {
      toast.push(friendlyErrorMessage(err, "Invalid or expired code."), "danger");
    } finally {
      setRedeeming(false);
    }
  }

  return (
    <div className="bg-casino-ambient p-4 lg:p-6">
      {/* Cinematic page header — an entertainment wall, not a form. */}
      <div className="relative mb-6 overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="bg-casino-vignette absolute inset-0" />
        <div
          className="absolute inset-0 opacity-30 animate-ambient-drift"
          style={{
            background:
              "radial-gradient(60% 80% at 15% 20%, rgb(var(--color-accent-gc) / 0.35), transparent 60%), radial-gradient(55% 80% at 90% 80%, rgb(var(--color-accent-sc) / 0.3), transparent 60%)",
          }}
        />
        <div className="relative z-10 p-5 sm:p-7">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent-gc">Vaultline Rewards</p>
          <h1 className="mt-1 text-2xl font-black uppercase tracking-tight text-text-primary sm:text-3xl">
            Promotions
          </h1>
          <p className="mt-1.5 max-w-md text-sm text-text-muted">
            Bonuses, challenges and rewards — live and ready to claim.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {loading &&
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-64 w-full rounded-2xl" />)}

        {!loading && (data?.length ?? 0) === 0 && (
          <p className="text-sm text-text-muted sm:col-span-2">No active promotions right now — check back soon.</p>
        )}

        {!loading &&
          data?.map((promo, i) => {
            const limitReached =
              promo.claimLimitPerUser != null && (claimCounts.get(promo.id) ?? 0) >= promo.claimLimitPerUser;
            return (
              <PromoCard
                key={promo.id}
                promo={promo}
                claimed={limitReached}
                claiming={claiming === promo.id}
                onClaim={claim}
                index={i}
              />
            );
          })}

        {!loading &&
          COMING_SOON.map((item, i) => (
            <ComingSoonPromoCard
              key={item.seed}
              title={item.title}
              description={item.description}
              type={item.type}
              seed={item.seed}
              index={(data?.length ?? 0) + i}
            />
          ))}
      </div>

      {/* De-emphasized promo-code redemption — a slim, low-key strip at the
          bottom of the page, not the hero element. */}
      <form
        onSubmit={redeemCode}
        className="mx-auto mt-8 flex max-w-sm items-center gap-2 rounded-lg border border-border/70 bg-surface/40 px-3 py-2"
      >
        <Gift className="hidden h-3.5 w-3.5 shrink-0 text-text-muted sm:block" />
        <span className="hidden shrink-0 text-xs text-text-muted sm:inline">Promo code</span>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Have a code?"
          className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-1.5 text-xs outline-none focus:border-accent-sc"
        />
        <Button type="submit" size="sm" variant="secondary" loading={redeeming} disabled={!code}>
          Redeem
        </Button>
      </form>
    </div>
  );
}
