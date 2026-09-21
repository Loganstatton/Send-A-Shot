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
import type { Game } from "@/lib/types";

interface AdminGame extends Game {
  active: boolean;
  featured: boolean;
}

export default function AdminGamesPage() {
  const toast = useToast();
  const fetcher = useCallback(() => api.get<AdminGame[]>("/admin/games"), []);
  const { data, loading, refetch } = useFetch(fetcher);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function toggle(id: string, field: "active" | "featured", value: boolean) {
    setBusyId(id);
    try {
      await api.patch(`/admin/games/${id}`, { [field]: value });
      refetch();
    } catch (err) {
      toast.push(friendlyErrorMessage(err, "Could not update game."), "danger");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <AdminPageHeader title="Game management" description="Activate/deactivate, feature, and tag catalog games." />
      <div className="px-4 pb-8 lg:px-6">
        <Card>
          <CardContent className="p-0">
            {loading && (
              <div className="space-y-2 p-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            )}
            {!loading && (data?.length ?? 0) === 0 && <p className="p-6 text-center text-sm text-text-muted">No games in catalog yet.</p>}
            {!loading &&
              data?.map((g) => (
                <div key={g.id} className="flex items-center justify-between border-b border-border/60 px-4 py-3 text-sm last:border-b-0">
                  <div>
                    <p className="font-medium text-text-primary">{g.name}</p>
                    <p className="text-xs text-text-muted">
                      {typeof g.provider === "string" ? g.provider : (g.provider as { name?: string })?.name} · {g.category}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={g.active ? "success" : "neutral"}>{g.active ? "Active" : "Inactive"}</Badge>
                    {g.featured && <Badge variant="gc">Featured</Badge>}
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busyId === g.id}
                      onClick={() => toggle(g.id, "active", !g.active)}
                    >
                      {g.active ? "Deactivate" : "Activate"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === g.id}
                      onClick={() => toggle(g.id, "featured", !g.featured)}
                    >
                      {g.featured ? "Unfeature" : "Feature"}
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
