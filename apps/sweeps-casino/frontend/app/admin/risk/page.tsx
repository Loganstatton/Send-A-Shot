"use client";

import { useCallback, useState } from "react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useFetch } from "@/lib/hooks/useFetch";
import { api } from "@/lib/api-client";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useToast } from "@/components/layout/Toast";
import { formatDate } from "@/lib/utils";

interface RiskEvent {
  id: string;
  userId: string;
  username: string;
  ruleName: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  createdAt: string;
  status: "OPEN" | "RESOLVED";
}

const ACTIONS = ["PASS", "REVIEW", "LIMIT", "BLOCK"] as const;

export default function AdminRiskPage() {
  const toast = useToast();
  const fetcher = useCallback(() => api.get<RiskEvent[]>("/admin/risk/events"), []);
  const { data, loading, refetch } = useFetch(fetcher);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function resolve(id: string, action: (typeof ACTIONS)[number]) {
    setBusyId(id);
    try {
      await api.post(`/admin/risk/events/${id}/resolve`, { action });
      toast.push(`Event resolved: ${action}.`, "success");
      refetch();
    } catch (err) {
      toast.push(friendlyErrorMessage(err, "Could not resolve event."), "danger");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <AdminPageHeader title="Risk / fraud queue" description="Manual PASS / REVIEW / LIMIT / BLOCK actions on flagged events." />
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
            {!loading && (data?.length ?? 0) === 0 && <p className="p-6 text-center text-sm text-text-muted">No open risk events.</p>}
            {!loading &&
              data
                ?.filter((e) => e.status === "OPEN")
                .map((e) => (
                  <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3 text-sm last:border-b-0">
                    <div>
                      <p className="font-medium text-text-primary">
                        {e.username} · {e.ruleName}
                      </p>
                      <p className="text-xs text-text-muted">{formatDate(e.createdAt)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={e.severity === "HIGH" ? "danger" : e.severity === "MEDIUM" ? "gc" : "neutral"}>
                        {e.severity}
                      </Badge>
                      {ACTIONS.map((a) => (
                        <Button
                          key={a}
                          size="sm"
                          variant={a === "BLOCK" ? "danger" : "secondary"}
                          disabled={busyId === e.id}
                          onClick={() => resolve(e.id, a)}
                        >
                          {a}
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
