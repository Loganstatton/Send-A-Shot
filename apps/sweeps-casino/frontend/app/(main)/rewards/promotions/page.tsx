"use client";

import { useCallback, useState } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { useFetch } from "@/lib/hooks/useFetch";
import { api, ApiError } from "@/lib/api-client";
import type { Promotion } from "@/lib/types";
import { useToast } from "@/components/layout/Toast";
import { useWalletStore } from "@/lib/stores/wallet-store";

export default function PromotionsPage() {
  const toast = useToast();
  const fetchBalances = useWalletStore((s) => s.fetchBalances);
  const fetcher = useCallback(() => api.get<Promotion[]>("/promotions?status=active"), []);
  const { data, loading, refetch } = useFetch(fetcher);
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
      toast.push(err instanceof ApiError ? err.message : "Could not claim this promotion.", "danger");
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
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "Invalid or expired code.", "danger");
    } finally {
      setRedeeming(false);
    }
  }

  return (
    <div className="p-4 lg:p-6">
      <h1 className="mb-4 text-xl font-bold text-text-primary">Promotions</h1>

      <Card className="mb-5">
        <CardContent className="p-4">
          <form onSubmit={redeemCode} className="flex items-end gap-2">
            <div className="flex-1">
              <label className="mb-1.5 block text-xs font-medium text-text-muted">Have a promo code?</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Enter code"
                className="w-full rounded-lg border border-border bg-surface-raised px-3.5 py-2.5 text-sm outline-none focus:border-accent-sc"
              />
            </div>
            <Button type="submit" loading={redeeming} disabled={!code}>
              Redeem
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {loading &&
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}

        {!loading && (data?.length ?? 0) === 0 && (
          <p className="text-sm text-text-muted sm:col-span-2">No active promotions right now — check back soon.</p>
        )}

        {!loading &&
          data?.map((promo) => (
            <Card key={promo.id}>
              <CardContent className="flex h-full flex-col p-5">
                <div className="mb-2 flex items-center justify-between">
                  <Badge variant="gc">{promo.type.replace("_", " ")}</Badge>
                </div>
                <h3 className="text-sm font-semibold text-text-primary">{promo.title}</h3>
                <p className="mt-1 flex-1 text-xs text-text-muted">{promo.description}</p>
                <Button
                  size="sm"
                  className="mt-4 self-start"
                  onClick={() => claim(promo.id)}
                  loading={claiming === promo.id}
                >
                  Claim
                </Button>
              </CardContent>
            </Card>
          ))}
      </div>
    </div>
  );
}
