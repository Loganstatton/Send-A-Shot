"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useAuthStore } from "@/lib/stores/auth-store";
import { api, ApiError } from "@/lib/api-client";
import { useToast } from "@/components/layout/Toast";

export default function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const refetchMe = useAuthStore((s) => s.refetchMe);
  const toast = useToast();
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [chatAnonymized, setChatAnonymized] = useState(user?.chatAnonymized ?? false);
  const [marketingOptIn, setMarketingOptIn] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDisplayName(user?.displayName ?? "");
    setChatAnonymized(user?.chatAnonymized ?? false);
  }, [user]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch("/me/profile", { displayName, chatAnonymized, marketingOptIn });
      await refetchMe();
      toast.push("Profile updated.", "success");
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "Could not update profile.", "danger");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl p-4 lg:p-6">
      <h1 className="mb-4 text-xl font-bold text-text-primary">Profile</h1>

      <Card className="mb-5">
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-3 text-sm">
          <div className="flex justify-between">
            <span className="text-text-muted">Username</span>
            <span className="font-medium text-text-primary">{user?.username}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Email</span>
            <span className="font-medium text-text-primary">{user?.email}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">State of record</span>
            <span className="font-medium text-text-primary">{user?.stateOfRecord ?? "—"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-muted">KYC status</span>
            <Badge variant={user?.kycStatus === "APPROVED" ? "success" : "neutral"}>
              {user?.kycStatus ?? "NOT_STARTED"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preferences</CardTitle>
        </CardHeader>
        <CardContent className="pt-3">
          <form onSubmit={onSave} className="space-y-4">
            <Input
              label="Display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Shown on leaderboards and chat"
            />
            <label className="flex items-center gap-2 text-sm text-text-primary">
              <input
                type="checkbox"
                checked={chatAnonymized}
                onChange={(e) => setChatAnonymized(e.target.checked)}
              />
              Anonymize my name in chat and community activity
            </label>
            <label className="flex items-center gap-2 text-sm text-text-primary">
              <input
                type="checkbox"
                checked={marketingOptIn}
                onChange={(e) => setMarketingOptIn(e.target.checked)}
              />
              Send me promotional emails
            </label>
            <Button type="submit" loading={saving}>
              Save changes
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
