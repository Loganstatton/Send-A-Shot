"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Tabs } from "@/components/ui/Tabs";
import { Card, CardContent } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useFetch } from "@/lib/hooks/useFetch";
import { useCursorList } from "@/lib/hooks/useCursorList";
import { api } from "@/lib/api-client";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useWalletStore } from "@/lib/stores/wallet-store";
import type { CursorPage, LedgerEntry, RedemptionEligibility } from "@/lib/types";
import { formatCoins, formatDate, cn } from "@/lib/utils";
import { Coins, Lock, Gift } from "@/components/ui/icons";

const TABS = [
  { key: "gc", label: "Gold Coins" },
  { key: "sc", label: "Sweeps Coins" },
  { key: "transactions", label: "Transactions" },
  { key: "redeem", label: "Redeem" },
  { key: "rewards", label: "Rewards" },
];

function WalletPageBody() {
  const params = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") || "gc");
  const user = useAuthStore((s) => s.user);
  const balances = useWalletStore((s) => s.balances);
  const fetchBalances = useWalletStore((s) => s.fetchBalances);

  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  const scEnabled = user?.featureFlags?.["sc.enabled"] ?? false;

  return (
    <div className="p-4 lg:p-6">
      <h1 className="mb-4 text-xl font-bold text-text-primary">Wallet</h1>
      <Tabs tabs={TABS} active={tab} onChange={setTab} className="mb-5" />

      {tab === "gc" && (
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-accent-gc">
              <Coins className="h-5 w-5" />
              <span className="text-sm font-semibold">Gold Coins</span>
            </div>
            <p className="mt-2 font-mono text-4xl font-extrabold text-text-primary">
              {balances ? formatCoins(balances.gc.balance) : <Skeleton className="h-10 w-32" />}
            </p>
            <p className="mt-2 max-w-md text-xs text-text-muted">
              Gold Coins are for entertainment purposes only, have no cash value, and cannot be redeemed for cash or
              prizes.
            </p>
          </CardContent>
        </Card>
      )}

      {tab === "sc" && (
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-accent-sc">
              <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-current text-[10px]">
                S
              </span>
              <span className="text-sm font-semibold">Sweeps Coins</span>
            </div>
            <p className="mt-2 font-mono text-4xl font-extrabold text-text-primary">
              {balances ? formatCoins(balances.sc.balance) : <Skeleton className="h-10 w-32" />}
            </p>
            {!scEnabled && (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-accent-sc/25 bg-accent-sc/5 p-3">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-accent-sc" />
                <p className="text-xs text-text-muted">
                  Sweeps Coins are a promotional sweepstakes currency, pending compliance approval in your state.
                  Most SC features are disabled until legal/compliance sign-off completes — this is expected, not a
                  bug.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "transactions" && <TransactionsTab />}
      {tab === "redeem" && <RedeemTab />}
      {tab === "rewards" && <RewardsTab />}
    </div>
  );
}

function TransactionsTab() {
  const [currency, setCurrency] = useState<"" | "GC" | "SC">("");
  const fetchPage = useCallback(
    (cursor: string | null) => {
      const qs = new URLSearchParams();
      if (currency) qs.set("currency", currency);
      if (cursor) qs.set("cursor", cursor);
      return api.get<CursorPage<LedgerEntry>>(`/wallet/transactions?${qs.toString()}`);
    },
    [currency]
  );
  const { items, loading, loadingMore, hasMore, loadMore } = useCursorList(fetchPage, [currency]);

  return (
    <div>
      <div className="mb-3 flex gap-2">
        {(["", "GC", "SC"] as const).map((c) => (
          <button
            key={c}
            onClick={() => setCurrency(c)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium",
              currency === c ? "border-accent-sc bg-accent-sc/10 text-accent-sc" : "border-border text-text-muted"
            )}
          >
            {c || "All"}
          </button>
        ))}
      </div>
      <Card>
        <CardContent className="p-0">
          {loading && (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          )}
          {!loading && items.length === 0 && (
            <p className="p-6 text-center text-sm text-text-muted">No transactions yet.</p>
          )}
          {!loading &&
            items.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between border-b border-border/60 px-4 py-3 text-sm last:border-b-0">
                <div>
                  <p className="font-medium text-text-primary">{tx.type}</p>
                  <p className="text-xs text-text-muted">{formatDate(tx.createdAt)}</p>
                </div>
                <div className="text-right">
                  <p className={cn("font-mono font-semibold", tx.amount >= 0 ? "text-success" : "text-danger")}>
                    {tx.amount >= 0 ? "+" : ""}
                    {formatCoins(tx.amount)} {tx.currency}
                  </p>
                  <p className="text-[11px] text-text-muted">Bal. {formatCoins(tx.balanceAfter)}</p>
                </div>
              </div>
            ))}
        </CardContent>
      </Card>
      {!loading && hasMore && (
        <div className="mt-4 flex justify-center">
          <button onClick={loadMore} disabled={loadingMore} className="text-sm text-accent-sc hover:underline">
            {loadingMore ? "Loading..." : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}

function RedeemTab() {
  const fetcher = useCallback(() => api.get<RedemptionEligibility>("/redemptions/eligibility"), []);
  const { data, loading } = useFetch(fetcher);

  if (loading) return <Skeleton className="h-40 w-full rounded-xl" />;

  return (
    <EmptyState
      icon={<Lock className="h-10 w-10" />}
      title="Redemptions are pending compliance approval"
      description={
        data?.message ||
        "SC redemption for prizes is disabled while jurisdiction, KYC, and payout compliance work is finalized. Once enabled in your state, this tab will let you request a redemption directly."
      }
      phase="P2"
    />
  );
}

function RewardsTab() {
  return (
    <EmptyState
      icon={<Gift className="h-10 w-10" />}
      title="Reward history lives in the Rewards section"
      description="See VIP rewards, promotion claims, and your daily bonus streak under Rewards in the sidebar."
      action={
        <a href="/rewards/promotions" className="text-sm text-accent-sc hover:underline">
          Go to Rewards
        </a>
      }
    />
  );
}

export default function WalletPage() {
  return (
    <Suspense fallback={null}>
      <WalletPageBody />
    </Suspense>
  );
}
