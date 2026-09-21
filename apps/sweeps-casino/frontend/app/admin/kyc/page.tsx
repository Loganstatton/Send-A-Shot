"use client";

import { useCallback, useState } from "react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useFetch } from "@/lib/hooks/useFetch";
import { api, ApiError } from "@/lib/api-client";
import { useToast } from "@/components/layout/Toast";
import { formatDate } from "@/lib/utils";

interface KycQueueItem {
  recordId: string;
  userId: string;
  username: string;
  status: string;
  submittedAt: string;
}

export default function AdminKycPage() {
  const toast = useToast();
  const fetcher = useCallback(() => api.get<KycQueueItem[]>("/admin/kyc/queue"), []);
  const { data, loading, refetch } = useFetch(fetcher);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function decide(recordId: string, decision: "approve" | "reject" | "review-required") {
    setBusyId(recordId);
    try {
      await api.post(`/admin/kyc/${recordId}/decision`, { decision, reason: `${decision} via admin panel` });
      toast.push(`Record ${decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "flagged for review"}.`, "success");
      refetch();
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "Could not record decision.", "danger");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <AdminPageHeader title="KYC review queue" description="Reviewing against the mock KYC provider in Phase 1." />
      <div className="px-4 pb-8 lg:px-6">
        <Card>
          <CardContent className="p-0">
            {loading && (
              <div className="space-y-2 p-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            )}
            {!loading && (data?.length ?? 0) === 0 && <p className="p-6 text-center text-sm text-text-muted">No records pending review.</p>}
            {!loading &&
              data?.map((r) => (
                <div key={r.recordId} className="flex items-center justify-between border-b border-border/60 px-4 py-3 text-sm last:border-b-0">
                  <div>
                    <p className="font-medium text-text-primary">{r.username}</p>
                    <p className="text-xs text-text-muted">Submitted {formatDate(r.submittedAt)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="neutral">{r.status}</Badge>
                    <Button size="sm" variant="secondary" disabled={busyId === r.recordId} onClick={() => decide(r.recordId, "review-required")}>
                      Flag
                    </Button>
                    <Button size="sm" variant="danger" disabled={busyId === r.recordId} onClick={() => decide(r.recordId, "reject")}>
                      Reject
                    </Button>
                    <Button size="sm" variant="primary" disabled={busyId === r.recordId} onClick={() => decide(r.recordId, "approve")}>
                      Approve
                    </Button>
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
