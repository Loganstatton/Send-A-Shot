"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { useDebounce } from "@/lib/hooks/useDebounce";
import { useFetch } from "@/lib/hooks/useFetch";
import { api } from "@/lib/api-client";
import type { AdminUserSummary } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { Search } from "@/components/ui/icons";

export default function AdminUsersPage() {
  const [query, setQuery] = useState("");
  const debounced = useDebounce(query, 300);

  const fetcher = useCallback(
    () => api.get<AdminUserSummary[]>(`/admin/users?query=${encodeURIComponent(debounced)}`),
    [debounced]
  );
  const { data, loading } = useFetch(fetcher, [debounced]);

  return (
    <div>
      <AdminPageHeader title="Users" description="Search by username, email, user ID, or transaction ID." />
      <div className="px-4 pb-8 lg:px-6">
        <div className="mb-4 max-w-md">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search users..."
            rightAdornment={<Search className="h-4 w-4" />}
          />
        </div>

        <Card>
          <CardContent className="p-0">
            {loading && (
              <div className="space-y-2 p-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            )}
            {!loading && (data?.length ?? 0) === 0 && (
              <p className="p-6 text-center text-sm text-text-muted">No users match that search.</p>
            )}
            {!loading &&
              data?.map((u) => (
                <Link
                  key={u.id}
                  href={`/admin/users/${u.id}`}
                  className="flex items-center justify-between border-b border-border/60 px-4 py-3 text-sm last:border-b-0 hover:bg-surface-raised"
                >
                  <div>
                    <p className="font-medium text-text-primary">{u.username}</p>
                    <p className="text-xs text-text-muted">{u.email}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-text-muted">{formatDate(u.createdAt)}</span>
                    <Badge variant={u.status === "ACTIVE" ? "success" : u.status === "SUSPENDED" ? "danger" : "neutral"}>
                      {u.status}
                    </Badge>
                  </div>
                </Link>
              ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
