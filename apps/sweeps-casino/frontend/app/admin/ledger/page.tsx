"use client";

import { useCallback, useState } from "react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { useFetch } from "@/lib/hooks/useFetch";
import { api } from "@/lib/api-client";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useToast } from "@/components/layout/Toast";
import { formatDate } from "@/lib/utils";

interface ReconciliationRun {
  id: string;
  status: "OK" | "DRIFT_DETECTED" | "RUNNING";
  runAt: string;
  walletsChecked: number;
  discrepancies: number;
}

export default function AdminLedgerPage() {
  const toast = useToast();
  const fetcher = useCallback(() => api.get<ReconciliationRun[]>("/admin/ledger/reconciliation"), []);
  const { data, loading, refetch } = useFetch(fetcher);
  const [running, setRunning] = useState(false);

  async function runNow() {
    setRunning(true);
    try {
      await api.post("/admin/ledger/reconciliation/run", {}, { idempotent: true });
      toast.push("Reconciliation run started.", "success");
      refetch();
    } catch (err) {
      toast.push(friendlyErrorMessage(err, "Could not start reconciliation."), "danger");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <AdminPageHeader
        title="Ledger reconciliation"
        description="wallets.balance is a cache — SUM(ledger_entries.amount) is authoritative. This view surfaces drift."
        action={
          <Button onClick={runNow} loading={running}>
            Run now
          </Button>
        }
      />
      <div className="px-4 pb-8 lg:px-6">
        <Card>
          <CardContent className="p-0">
            {loading && (
              <div className="space-y-2 p-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            )}
            {!loading && (data?.length ?? 0) === 0 && (
              <p className="p-6 text-center text-sm text-text-muted">No reconciliation runs yet.</p>
            )}
            {!loading &&
              data?.map((run) => (
                <div key={run.id} className="flex items-center justify-between border-b border-border/60 px-4 py-3 text-sm last:border-b-0">
                  <span>{formatDate(run.runAt)}</span>
                  <span className="text-text-muted">{run.walletsChecked.toLocaleString()} wallets checked</span>
                  <Badge variant={run.status === "OK" ? "success" : run.status === "RUNNING" ? "neutral" : "danger"}>
                    {run.status === "DRIFT_DETECTED" ? `${run.discrepancies} discrepancies` : run.status}
                  </Badge>
                </div>
              ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
