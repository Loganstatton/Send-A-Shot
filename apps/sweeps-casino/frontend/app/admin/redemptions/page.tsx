"use client";

import { useCallback, useState } from "react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useFetch } from "@/lib/hooks/useFetch";
import { api, ApiError } from "@/lib/api-client";
import { useToast } from "@/components/layout/Toast";
import { formatCoins, formatDate } from "@/lib/utils";
import { Lock } from "@/components/ui/icons";

interface RedemptionRow {
  id: string;
  username: string;
  amount: number;
  status: "PENDING" | "APPROVED" | "REJECTED" | "PROCESSING" | "PAID";
  createdAt: string;
}

export default function AdminRedemptionsPage() {
  const toast = useToast();
  const fetcher = useCallback(() => api.get<RedemptionRow[]>("/admin/redemptions"), []);
  const { data, loading, refetch } = useFetch(fetcher);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function decide(id: string, decision: string) {
    setBusyId(id);
    try {
      await api.post(`/admin/redemptions/${id}/decision`, { decision });
      toast.push(`Redemption ${decision.toLowerCase()}.`, "success");
      refetch();
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "Could not update redemption.", "danger");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <AdminPageHeader
        title="Redemptions review"
        description="Functionally inert until redemptions.enabled is on — the queue still renders any historical/test requests."
      />
      <div className="px-4 pb-8 lg:px-6">
        {!loading && (data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={<Lock className="h-10 w-10" />}
            title="No redemption requests"
            description="Redemptions are disabled by the redemptions.enabled feature flag. This queue is fully wired and will populate once the flag is enabled and players can submit requests."
            phase="P2"
          />
        ) : (
          <Card>
            <CardContent className="p-0">
              {loading && (
                <div className="space-y-2 p-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              )}
              {!loading &&
                data?.map((r) => (
                  <div key={r.id} className="flex items-center justify-between border-b border-border/60 px-4 py-3 text-sm last:border-b-0">
                    <div>
                      <p className="font-medium text-text-primary">{r.username}</p>
                      <p className="text-xs text-text-muted">{formatDate(r.createdAt)}</p>
                    </div>
                    <span className="font-mono">{formatCoins(r.amount)} SC</span>
                    <div className="flex items-center gap-2">
                      <Badge variant={r.status === "PAID" ? "success" : r.status === "REJECTED" ? "danger" : "neutral"}>
                        {r.status}
                      </Badge>
                      {r.status === "PENDING" && (
                        <>
                          <Button size="sm" variant="danger" disabled={busyId === r.id} onClick={() => decide(r.id, "REJECT")}>
                            Reject
                          </Button>
                          <Button size="sm" variant="primary" disabled={busyId === r.id} onClick={() => decide(r.id, "APPROVE")}>
                            Approve
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
