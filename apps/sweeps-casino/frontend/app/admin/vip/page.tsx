"use client";

import { useCallback, useState } from "react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useFetch } from "@/lib/hooks/useFetch";
import { api } from "@/lib/api-client";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useToast } from "@/components/layout/Toast";

// Full admin-facing shape (backend VipLevel Prisma model), distinct from
// the public VipLevel in lib/types.ts which deliberately omits point
// thresholds/multipliers. See backend/src/modules/vip/admin-vip.controller.ts.
interface AdminVipLevel {
  id: string;
  rankOrder: number;
  name: string;
  minPoints: string;
  gcPointsMultiplier: string;
  scPointsMultiplier: string;
  benefits: string[] | null;
}

export default function AdminVipPage() {
  const toast = useToast();
  const fetcher = useCallback(() => api.get<AdminVipLevel[]>("/admin/vip/levels"), []);
  const { data, loading, refetch } = useFetch(fetcher);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  async function save(level: AdminVipLevel) {
    const draft = drafts[level.id];
    if (draft === undefined || draft === "") return;
    setSavingId(level.id);
    try {
      await api.patch(`/admin/vip/levels/${level.id}`, { minPoints: Number(draft).toFixed(2) });
      toast.push(`${level.name} updated.`, "success");
      refetch();
    } catch (err) {
      toast.push(friendlyErrorMessage(err, "Could not update level."), "danger");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div>
      <AdminPageHeader title="VIP configuration" description="Edit the level ladder's point thresholds and benefits." />
      <div className="px-4 pb-8 lg:px-6">
        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        )}
        {!loading &&
          data?.map((lvl) => (
            <Card key={lvl.id} className="mb-2">
              <CardContent className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-text-primary">
                    {lvl.rankOrder}. {lvl.name}
                  </p>
                  {Array.isArray(lvl.benefits) && lvl.benefits.length > 0 && (
                    <p className="truncate text-xs text-text-muted">{lvl.benefits.join(" · ")}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    className="w-32"
                    type="number"
                    placeholder={String(Math.round(Number(lvl.minPoints)))}
                    value={drafts[lvl.id] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [lvl.id]: e.target.value }))}
                  />
                  <Button size="sm" variant="secondary" loading={savingId === lvl.id} onClick={() => save(lvl)}>
                    Save
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
      </div>
    </div>
  );
}
