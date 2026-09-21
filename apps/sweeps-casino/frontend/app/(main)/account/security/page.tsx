"use client";

import { useCallback, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { useFetch } from "@/lib/hooks/useFetch";
import { api, ApiError } from "@/lib/api-client";
import type { Session } from "@/lib/types";
import { useToast } from "@/components/layout/Toast";
import { formatDate } from "@/lib/utils";
import { Lock } from "@/components/ui/icons";

export default function SecurityPage() {
  const toast = useToast();
  const fetcher = useCallback(() => api.get<Session[]>("/auth/sessions"), []);
  const { data: sessions, loading, refetch } = useFetch(fetcher);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/me/password", { currentPassword, newPassword });
      toast.push("Password updated.", "success");
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "Could not update password.", "danger");
    } finally {
      setSaving(false);
    }
  }

  async function revoke(id: string) {
    try {
      await api.delete(`/auth/sessions/${id}`);
      toast.push("Session revoked.", "success");
      refetch();
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "Could not revoke session.", "danger");
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-4 lg:p-6">
      <h1 className="mb-4 text-xl font-bold text-text-primary">Security</h1>

      <Card className="mb-5">
        <CardHeader>
          <CardTitle>Change password</CardTitle>
        </CardHeader>
        <CardContent className="pt-3">
          <form onSubmit={changePassword} className="space-y-4">
            <Input
              label="Current password"
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
            <Input
              label="New password"
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <Button type="submit" loading={saving}>
              Update password
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="mb-5">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Two-factor authentication</CardTitle>
          <Badge variant="sc">P2</Badge>
        </CardHeader>
        <CardContent className="pt-3">
          <div className="flex items-start gap-2 text-sm text-text-muted">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              TOTP-based 2FA is wired on the backend (login already supports a 2FA challenge) but the setup UI ships
              in Phase 2. Coming soon.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sessions &amp; login history</CardTitle>
        </CardHeader>
        <CardContent className="pt-3">
          {loading && (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          )}
          {!loading && (sessions?.length ?? 0) === 0 && (
            <p className="text-sm text-text-muted">No other active sessions.</p>
          )}
          {!loading &&
            sessions?.map((s) => (
              <div key={s.id} className="flex items-center justify-between border-b border-border/60 py-3 text-sm last:border-b-0">
                <div>
                  <p className="font-medium text-text-primary">
                    {s.device} {s.current && <Badge variant="success">This device</Badge>}
                  </p>
                  <p className="text-xs text-text-muted">
                    {s.ip ? `${s.ip} · ` : ""}
                    Last active {formatDate(s.lastActiveAt)}
                  </p>
                </div>
                {!s.current && (
                  <Button size="sm" variant="outline" onClick={() => revoke(s.id)}>
                    Revoke
                  </Button>
                )}
              </div>
            ))}
        </CardContent>
      </Card>
    </div>
  );
}
