"use client";

import { useCallback, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { useFetch } from "@/lib/hooks/useFetch";
import { api } from "@/lib/api-client";
import { friendlyErrorMessage } from "@/lib/error-messages";
import type { Promotion, PromotionClaim } from "@/lib/types";
import { useToast } from "@/components/layout/Toast";
import { useWalletStore } from "@/lib/stores/wallet-store";
import { PromoCard } from "@/components/casino/PromoCard";

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
    <div className="p-4 lg:p-6">
      <h1 className="mb-4 text-xl font-bold text-text-primary">Promotions</h1>

      {/* De-emphasized relative to the promotions below — a slim inline
          form, not a full-width card competing for attention. */}
      <form
        onSubmit={redeemCode}
        className="mb-5 flex items-center gap-2 rounded-lg border border-border bg-surface-raised/60 px-3 py-2"
      >
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {loading &&
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-48 w-full rounded-xl" />)}

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
      </div>
    </div>
  );
}
