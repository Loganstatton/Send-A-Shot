"use client";

import { useCallback, useState } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { Select } from "@/components/ui/Select";
import { useCursorList } from "@/lib/hooks/useCursorList";
import { api } from "@/lib/api-client";
import type { CursorPage, LedgerEntry } from "@/lib/types";
import { formatCoins, formatDate, cn } from "@/lib/utils";

const TYPES = ["", "BET", "WIN", "REFUND", "ROLLBACK", "PROMO_CLAIM", "ADMIN_ADJUSTMENT", "REDEMPTION"];

export default function TransactionsPage() {
  const [currency, setCurrency] = useState("");
  const [type, setType] = useState("");

  const fetchPage = useCallback(
    (cursor: string | null) => {
      const qs = new URLSearchParams();
      if (currency) qs.set("currency", currency);
      if (type) qs.set("type", type);
      if (cursor) qs.set("cursor", cursor);
      return api.get<CursorPage<LedgerEntry>>(`/wallet/transactions?${qs.toString()}`);
    },
    [currency, type]
  );

  const { items, loading, loadingMore, hasMore, loadMore } = useCursorList(fetchPage, [currency, type]);

  return (
    <div className="p-4 lg:p-6">
      <h1 className="mb-4 text-xl font-bold text-text-primary">Transactions</h1>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:w-96">
        <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
          <option value="">All currencies</option>
          <option value="GC">Gold Coins</option>
          <option value="SC">Sweeps Coins</option>
        </Select>
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t || "All types"}
            </option>
          ))}
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading && (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          )}
          {!loading && items.length === 0 && (
            <p className="p-6 text-center text-sm text-text-muted">No transactions match those filters.</p>
          )}
          {!loading &&
            items.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between border-b border-border/60 px-4 py-3 text-sm last:border-b-0"
              >
                <div>
                  <p className="font-medium text-text-primary">{tx.type}</p>
                  <p className="text-xs text-text-muted">{formatDate(tx.createdAt)}</p>
                  {tx.description && <p className="text-xs text-text-muted">{tx.description}</p>}
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
