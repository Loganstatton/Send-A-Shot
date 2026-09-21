"use client";

import { useCallback, useState } from "react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Tabs } from "@/components/ui/Tabs";
import { Skeleton } from "@/components/ui/Skeleton";
import { useFetch } from "@/lib/hooks/useFetch";
import { api } from "@/lib/api-client";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useToast } from "@/components/layout/Toast";
import { US_STATES } from "@/lib/us-states";

interface JurisdictionRow {
  state: string;
  status: "BLOCKED" | "REGISTRATION_DISABLED" | "SC_DISABLED" | "GC_ONLY" | "REDEMPTION_DISABLED" | "ALLOWED";
}

interface FeatureFlagRow {
  key: string;
  enabled: boolean;
  updatedBy?: string;
  updatedAt?: string;
}

const STATUS_OPTIONS: JurisdictionRow["status"][] = [
  "BLOCKED",
  "REGISTRATION_DISABLED",
  "SC_DISABLED",
  "GC_ONLY",
  "REDEMPTION_DISABLED",
  "ALLOWED",
];

export default function AdminCompliancePage() {
  const toast = useToast();
  const [tab, setTab] = useState("jurisdictions");

  const jFetcher = useCallback(() => api.get<JurisdictionRow[]>("/admin/compliance/jurisdictions"), []);
  const { data: jurisdictions, loading: jLoading, refetch: refetchJ } = useFetch(jFetcher);

  const fFetcher = useCallback(() => api.get<FeatureFlagRow[]>("/admin/compliance/feature-flags"), []);
  const { data: flags, loading: fLoading, refetch: refetchF } = useFetch(fFetcher);

  async function updateStatus(state: string, status: string) {
    try {
      await api.patch("/admin/compliance/jurisdictions", { state, status });
      toast.push(`${state} status updated to ${status}.`, "success");
      refetchJ();
    } catch (err) {
      toast.push(friendlyErrorMessage(err, "Could not update jurisdiction."), "danger");
    }
  }

  async function toggleFlag(key: string, enabled: boolean) {
    try {
      await api.patch("/admin/compliance/feature-flags", { key, enabled });
      toast.push(`${key} ${enabled ? "enabled" : "disabled"}.`, "success");
      refetchF();
    } catch (err) {
      toast.push(friendlyErrorMessage(err, "Could not update flag."), "danger");
    }
  }

  const jurisdictionMap = new Map((jurisdictions ?? []).map((j) => [j.state, j.status]));

  return (
    <div>
      <AdminPageHeader
        title="Compliance center"
        description="Per-state jurisdiction status and SC-adjacent feature flags. Every change is versioned."
      />
      <div className="px-4 pb-8 lg:px-6">
        <Tabs
          tabs={[
            { key: "jurisdictions", label: "Jurisdictions" },
            { key: "flags", label: "Feature Flags" },
          ]}
          active={tab}
          onChange={setTab}
          className="mb-4"
        />

        {tab === "jurisdictions" && (
          <Card>
            <CardContent className="p-0">
              {jLoading && (
                <div className="space-y-2 p-4">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              )}
              {!jLoading &&
                US_STATES.map((s) => (
                  <div key={s.code} className="flex items-center justify-between border-b border-border/60 px-4 py-2.5 text-sm last:border-b-0">
                    <span className="font-medium text-text-primary">{s.name}</span>
                    <Select
                      className="w-56"
                      value={jurisdictionMap.get(s.code) ?? "ALLOWED"}
                      onChange={(e) => updateStatus(s.code, e.target.value)}
                    >
                      {STATUS_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt.replace(/_/g, " ")}
                        </option>
                      ))}
                    </Select>
                  </div>
                ))}
            </CardContent>
          </Card>
        )}

        {tab === "flags" && (
          <Card>
            <CardContent className="p-0">
              {fLoading && (
                <div className="space-y-2 p-4">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              )}
              {!fLoading && (flags?.length ?? 0) === 0 && (
                <p className="p-6 text-center text-sm text-text-muted">No feature flags loaded.</p>
              )}
              {!fLoading &&
                flags?.map((f) => (
                  <label key={f.key} className="flex items-center justify-between border-b border-border/60 px-4 py-3 text-sm last:border-b-0">
                    <span className="font-mono text-text-primary">{f.key}</span>
                    <input
                      type="checkbox"
                      checked={f.enabled}
                      onChange={(e) => toggleFlag(f.key, e.target.checked)}
                      className="h-4 w-4 accent-accent-sc"
                    />
                  </label>
                ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
