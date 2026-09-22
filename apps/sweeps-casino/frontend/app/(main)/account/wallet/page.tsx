"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
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
import type { CursorPage, LedgerEntry, RedemptionEligibility, WalletBalances } from "@/lib/types";
import { formatCoins, formatDate, cn } from "@/lib/utils";
import { Coins, Lock, Gift, Plus, CheckCircle } from "@/components/ui/icons";

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
  const redemptionsEnabled = user?.featureFlags?.["redemptions.enabled"] ?? false;

  // Shared across the SC tab and the Redeem tab, per sprint item 9 — one
  // fetch instead of two. `/redemptions/eligibility` is never flag-gated
  // server-side (it explains which gate is blocking even while disabled).
  const eligibilityFetcher = useCallback(() => api.get<RedemptionEligibility>("/redemptions/eligibility"), []);
  const { data: eligibility, loading: eligibilityLoading } = useFetch(eligibilityFetcher);

  return (
    <div className="p-4 lg:p-6">
      <h1 className="mb-4 text-xl font-bold text-text-primary">Wallet</h1>
      <Tabs tabs={TABS} active={tab} onChange={setTab} className="mb-5" />

      {tab === "gc" && <GcTab balances={balances} onViewAll={() => setTab("transactions")} />}

      {tab === "sc" && (
        <ScTab
          balances={balances}
          scEnabled={scEnabled}
          eligibility={eligibility}
          eligibilityLoading={eligibilityLoading}
        />
      )}

      {tab === "transactions" && <TransactionsTab />}
      {tab === "redeem" && (
        <RedeemTab redemptionsEnabled={redemptionsEnabled} eligibility={eligibility} loading={eligibilityLoading} />
      )}
      {tab === "rewards" && <RewardsTab />}
    </div>
  );
}

function GcTab({ balances, onViewAll }: { balances: WalletBalances | null; onViewAll: () => void }) {
  // Sprint item 9: a short "last 5" preview rather than duplicating the
  // full Transactions tab. `GET /wallet/transactions` has no `limit` query
  // param today, so this reuses the same endpoint as the Transactions tab
  // and just slices to the first page's first 5 entries.
  const fetcher = useCallback(() => api.get<CursorPage<LedgerEntry>>("/wallet/transactions?currency=GC"), []);
  const { data, loading } = useFetch(fetcher);
  const recent = (data?.items ?? []).slice(0, 5);

  return (
    <div className="space-y-4">
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

      {/* Purchase placeholder — Phase 1 has no purchase backend
          (payments.purchases_enabled is off with nothing implemented behind
          it yet), so this is a real, visible CTA that's honestly disabled
          rather than a functioning — or fake — checkout flow. */}
      <Card>
        <CardContent className="flex items-center justify-between gap-4 p-5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-primary">Add Gold Coins</p>
            <p className="mt-1 text-xs text-text-muted">Coin packages aren&apos;t available for purchase yet.</p>
          </div>
          <button
            type="button"
            disabled
            aria-disabled="true"
            title="Coming soon"
            className="flex shrink-0 cursor-not-allowed items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-3.5 py-2 text-xs font-semibold text-text-muted opacity-60"
          >
            <Plus className="h-3.5 w-3.5" />
            Coming Soon
          </button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
            <p className="text-sm font-semibold text-text-primary">Recent activity</p>
            <button type="button" onClick={onViewAll} className="text-xs font-medium text-accent-sc hover:underline">
              View all
            </button>
          </div>
          {loading && (
            <div className="space-y-2 p-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          )}
          {!loading && recent.length === 0 && (
            <p className="p-6 text-center text-sm text-text-muted">No Gold Coin activity yet.</p>
          )}
          {!loading &&
            recent.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between border-b border-border/60 px-4 py-3 text-sm last:border-b-0"
              >
                <div>
                  <p className="font-medium text-text-primary">{tx.type}</p>
                  <p className="text-xs text-text-muted">{formatDate(tx.createdAt)}</p>
                </div>
                <p className={cn("font-mono font-semibold", tx.amount >= 0 ? "text-success" : "text-danger")}>
                  {tx.amount >= 0 ? "+" : ""}
                  {formatCoins(tx.amount)}
                </p>
              </div>
            ))}
        </CardContent>
      </Card>
    </div>
  );
}

function ScTab({
  balances,
  scEnabled,
  eligibility,
  eligibilityLoading,
}: {
  balances: WalletBalances | null;
  scEnabled: boolean;
  eligibility: RedemptionEligibility | null;
  eligibilityLoading: boolean;
}) {
  // Only rendered when the backend actually sends these — never fabricated.
  const sc = balances?.sc;
  const hasBreakdown = !!sc && (sc.eligible !== undefined || sc.locked !== undefined);

  return (
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
        <p className="mt-1 text-xs text-text-muted">Available balance</p>

        {hasBreakdown && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            {sc!.locked !== undefined && (
              <div className="rounded-lg bg-surface-raised/60 p-3">
                <p className="text-[11px] text-text-muted">Locked / promotional</p>
                <p className="mt-0.5 font-mono text-base font-semibold text-text-primary">
                  {formatCoins(sc!.locked!)}
                </p>
              </div>
            )}
            {sc!.eligible !== undefined && (
              <div className="rounded-lg bg-surface-raised/60 p-3">
                <p className="text-[11px] text-text-muted">Redeemable</p>
                <p className="mt-0.5 font-mono text-base font-semibold text-text-primary">
                  {sc!.eligible ? "Yes" : "Not yet"}
                </p>
              </div>
            )}
          </div>
        )}

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

        <div className="mt-4 border-t border-border/60 pt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
            Redemption eligibility
          </p>
          {eligibilityLoading && <Skeleton className="h-6 w-40" />}
          {!eligibilityLoading && eligibility && (
            <div className="flex items-center gap-2">
              {eligibility.eligible ? (
                <CheckCircle className="h-4 w-4 shrink-0 text-success" />
              ) : (
                <Lock className="h-4 w-4 shrink-0 text-text-muted" />
              )}
              <p className="text-sm text-text-primary">
                {eligibility.eligible
                  ? "You're eligible to redeem Sweeps Coins."
                  : eligibility.message || "Not yet eligible to redeem."}
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

type SortOrder = "newest" | "oldest";

function TransactionsTab() {
  const [currency, setCurrency] = useState<"" | "GC" | "SC">("");
  const [sort, setSort] = useState<SortOrder>("newest");
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

  // The backend returns newest-first with no `sort` query param, so
  // "oldest" is a client-side reverse of whatever page(s) are already
  // loaded — not a re-sort of the full history. "Load more" is disabled
  // while oldest is active so paging in more (newest-relative) history
  // can't silently jumble the reversed view.
  const displayedItems = useMemo(() => (sort === "oldest" ? [...items].reverse() : items), [items, sort]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
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
        <div className="flex gap-0.5 rounded-full border border-border p-0.5">
          {(["newest", "oldest"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors",
                sort === s ? "bg-surface-raised text-text-primary" : "text-text-muted hover:text-text-primary"
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {sort === "oldest" && (
        <p className="mb-2 text-[11px] text-text-muted">
          Showing oldest-first among the transactions loaded so far. Switch back to Newest to load more history.
        </p>
      )}

      <Card>
        <CardContent className="p-0">
          {loading && (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          )}
          {!loading && displayedItems.length === 0 && (
            <p className="p-6 text-center text-sm text-text-muted">No transactions yet.</p>
          )}
          {!loading &&
            displayedItems.map((tx) => (
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
      {!loading && hasMore && sort === "newest" && (
        <div className="mt-4 flex justify-center">
          <button onClick={loadMore} disabled={loadingMore} className="text-sm text-accent-sc hover:underline">
            {loadingMore ? "Loading..." : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}

function RedeemTab({
  redemptionsEnabled,
  eligibility,
  loading,
}: {
  redemptionsEnabled: boolean;
  eligibility: RedemptionEligibility | null;
  loading: boolean;
}) {
  if (loading) return <Skeleton className="h-40 w-full rounded-xl" />;

  // Flag off (the default today): keep the existing "pending compliance"
  // framing, now actually driven by the flag instead of being the only
  // possible state.
  if (!redemptionsEnabled) {
    return (
      <EmptyState
        icon={<Lock className="h-10 w-10" />}
        title="Redemptions are pending compliance approval"
        description={
          eligibility?.message ||
          "SC redemption for prizes is disabled while jurisdiction, KYC, and payout compliance work is finalized. Once enabled in your state, this tab will let you request a redemption directly."
        }
        phase="P2"
      />
    );
  }

  // Flag on: show the already-fetched eligibility data plainly. Building a
  // redemption submission form is explicitly out of this sprint's scope.
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center gap-2">
          {eligibility?.eligible ? (
            <CheckCircle className="h-5 w-5 shrink-0 text-success" />
          ) : (
            <Lock className="h-5 w-5 shrink-0 text-accent-sc" />
          )}
          <p className="text-base font-semibold text-text-primary">
            {eligibility?.eligible ? "You're eligible to redeem Sweeps Coins" : "Not yet eligible to redeem"}
          </p>
        </div>
        {eligibility?.blockedBy && (
          <p className="mt-2 text-xs text-text-muted">Blocked by: {eligibility.blockedBy}</p>
        )}
        <p className="mt-2 text-sm text-text-muted">
          {eligibility?.message || "Redemption requests can't be submitted from here yet — check back soon."}
        </p>
      </CardContent>
    </Card>
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
