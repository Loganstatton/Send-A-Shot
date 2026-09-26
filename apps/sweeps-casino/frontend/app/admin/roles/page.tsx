"use client";

import { useCallback } from "react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { useFetch } from "@/lib/hooks/useFetch";
import { api } from "@/lib/api-client";

interface AdminRole {
  id: string;
  name: string;
  permissions: string[];
}

interface AdminUserRow {
  id: string;
  username: string;
  roleName: string;
  createdAt: string;
}

export default function AdminRolesPage() {
  const rolesFetcher = useCallback(() => api.get<AdminRole[]>("/admin/roles"), []);
  const { data: roles, loading: rolesLoading } = useFetch(rolesFetcher);

  const usersFetcher = useCallback(() => api.get<AdminUserRow[]>("/admin/admin-users"), []);
  const { data: adminUsers, loading: usersLoading } = useFetch(usersFetcher);

  return (
    <div>
      <AdminPageHeader title="Roles &amp; admin users" description="RBAC roles and who holds admin access." />
      <div className="px-4 pb-8 lg:px-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-muted">Roles</h2>
        <div className="mb-6 space-y-2">
          {rolesLoading && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
          {!rolesLoading &&
            roles?.map((r) => (
              <Card key={r.id}>
                <CardContent className="p-4">
                  <p className="text-sm font-semibold text-text-primary">{r.name ?? (r as unknown as { key: string }).key}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {Array.isArray(r.permissions) ? (
                      r.permissions.map((p) => (
                        <Badge key={p} variant="neutral">
                          {p}
                        </Badge>
                      ))
                    ) : (
                      <Badge variant="sc">All permissions</Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
        </div>

        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-muted">Admin users</h2>
        <Card>
          <CardContent className="p-0">
            {usersLoading && (
              <div className="space-y-2 p-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            )}
            {!usersLoading &&
              adminUsers?.map((u) => (
                <div key={u.id} className="flex items-center justify-between border-b border-border/60 px-4 py-3 text-sm last:border-b-0">
                  <span className="font-medium text-text-primary">{u.username}</span>
                  <Badge variant="sc">{u.roleName}</Badge>
                </div>
              ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
