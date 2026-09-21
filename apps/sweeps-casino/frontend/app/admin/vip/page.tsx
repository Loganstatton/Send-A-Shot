"use client";

import { useCallback, useState } from "react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useFetch } from "@/lib/hooks/useFetch";
import { api, ApiError } from "@/lib/api-client";
import { useToast } from "@/components/layout/Toast";
import type { VipLevel } from "@/lib/types";

export default function AdminVipPage() {
  const toast = useToast();
  const fetcher = useCallback(() => api.get<VipLevel[]>("/admin/vip/levels"), []);
  const { data, loading, refetch } = useFetch(fetcher);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [savingLevel, setSavingLevel] = useState<number | null>(null);

  async function save(level: VipLevel) {
    const draft = drafts[level.level];
    if (draft === undefined) return;
    setSavingLevel(level.level);
    try {
      await api.patch("/admin/vip/levels", { level: level.level, requiredPoints: parseInt(draft, 10) });
      toast.push(`Level ${level.level} updated.`, "success");
      refetch();
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "Could not update level.", "danger");
    } finally {
      setSavingLevel(null);
    }
  }

  return (
    <div>
      <AdminPageHeader title="VIP configuration" description="Edit the level ladder, point thresholds, and benefits." />
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
            <Card key={lvl.level} className="mb-2">
              <CardContent className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-text-primary">
                    {lvl.level}. {lvl.name}
                  </p>
                  <p className="truncate text-xs text-text-muted">{lvl.benefits.join(" · ")}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    className="w-32"
                    type="number"
                    placeholder={String(lvl.requiredPoints)}
                    value={drafts[lvl.level] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [lvl.level]: e.target.value }))}
                  />
                  <Button size="sm" variant="secondary" loading={savingLevel === lvl.level} onClick={() => save(lvl)}>
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
