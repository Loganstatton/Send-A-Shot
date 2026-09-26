"use client";

import { useCallback, useState } from "react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { useCursorList } from "@/lib/hooks/useCursorList";
import { api } from "@/lib/api-client";
import type { AuditLogEntry, CursorPage } from "@/lib/types";
import { formatDate } from "@/lib/utils";

export default function AdminAuditLogPage() {
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");

  const fetchPage = useCallback(
    (cursor: string | null) => {
      const qs = new URLSearchParams();
      if (actor) qs.set("actor", actor);
      if (action) qs.set("action", action);
      if (cursor) qs.set("cursor", cursor);
      return api.get<CursorPage<AuditLogEntry>>(`/admin/audit-log?${qs.toString()}`);
    },
    [actor, action]
  );

  const { items, loading, loadingMore, hasMore, loadMore } = useCursorList(fetchPage, [actor, action]);

  return (
    <div>
      <AdminPageHeader title="Audit log" description="Every mutating admin call writes a row here in the same transaction." />
      <div className="px-4 pb-8 lg:px-6">
        <div className="mb-4 grid grid-cols-2 gap-3 sm:w-96">
          <Input placeholder="Filter by actor" value={actor} onChange={(e) => setActor(e.target.value)} />
          <Input placeholder="Filter by action" value={action} onChange={(e) => setAction(e.target.value)} />
        </div>

        <Card>
          <CardContent className="p-0">
            {loading && <p className="p-6 text-center text-sm text-text-muted">Loading...</p>}
            {!loading && items.length === 0 && <p className="p-6 text-center text-sm text-text-muted">No matching audit events.</p>}
            {!loading &&
              items.map((e) => (
                <div key={e.id} className="border-b border-border/60 px-4 py-3 text-sm last:border-b-0">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-medium text-text-primary">{e.action}</span>
                    <span className="text-xs text-text-muted">{formatDate(e.createdAt)}</span>
                  </div>
                  <p className="text-xs text-text-muted">
                    {e.actor} → {e.target}
                  </p>
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
    </div>
  );
}
