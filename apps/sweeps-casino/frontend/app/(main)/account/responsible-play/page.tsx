"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { useFetch } from "@/lib/hooks/useFetch";
import { api, ApiError } from "@/lib/api-client";
import type { ResponsiblePlayState } from "@/lib/types";
import { useToast } from "@/components/layout/Toast";
import { AlertTriangle } from "@/components/ui/icons";

export default function ResponsiblePlayPage() {
  const toast = useToast();
  const fetcher = useCallback(() => api.get<ResponsiblePlayState>("/me/responsible-play"), []);
  const { data, loading, refetch } = useFetch(fetcher);

  const [depositLimit, setDepositLimit] = useState("");
  const [wagerLimit, setWagerLimit] = useState("");
  const [sessionLimit, setSessionLimit] = useState("");
  const [saving, setSaving] = useState(false);

  const [coolOffDays, setCoolOffDays] = useState("7");
  const [coolingOff, setCoolingOff] = useState(false);

  const [exclusionModal, setExclusionModal] = useState(false);
  const [exclusionDuration, setExclusionDuration] = useState("30");
  const [exclusionPermanent, setExclusionPermanent] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [excluding, setExcluding] = useState(false);

  useEffect(() => {
    if (!data) return;
    setDepositLimit(data.depositLimit ? String(data.depositLimit / 100) : "");
    setWagerLimit(data.wagerLimit ? String(data.wagerLimit / 100) : "");
    setSessionLimit(data.sessionTimeLimitMinutes ? String(data.sessionTimeLimitMinutes) : "");
  }, [data]);

  async function saveLimits(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch("/me/responsible-play", {
        depositLimit: depositLimit ? Math.round(parseFloat(depositLimit) * 100) : null,
        wagerLimit: wagerLimit ? Math.round(parseFloat(wagerLimit) * 100) : null,
        sessionTimeLimitMinutes: sessionLimit ? parseInt(sessionLimit, 10) : null,
      });
      toast.push("Limits updated.", "success");
      refetch();
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "Could not update limits.", "danger");
    } finally {
      setSaving(false);
    }
  }

  async function startCoolOff() {
    setCoolingOff(true);
    try {
      await api.patch("/me/responsible-play", { coolingOffDays: parseInt(coolOffDays, 10) });
      toast.push(`Cooling-off period started for ${coolOffDays} days.`, "success");
      refetch();
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "Could not start cooling-off.", "danger");
    } finally {
      setCoolingOff(false);
    }
  }

  async function confirmSelfExclude() {
    setExcluding(true);
    try {
      await api.post("/me/responsible-play/self-exclude", {
        durationDays: exclusionPermanent ? undefined : parseInt(exclusionDuration, 10),
        permanent: exclusionPermanent,
      });
      toast.push("Self-exclusion has been applied to your account.", "success");
      setExclusionModal(false);
      refetch();
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "Could not process self-exclusion.", "danger");
    } finally {
      setExcluding(false);
    }
  }

  if (loading) {
    return (
      <div className="p-4 lg:p-6">
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-4 lg:p-6">
      <h1 className="mb-1 text-xl font-bold text-text-primary">Responsible Play</h1>
      <p className="mb-5 text-sm text-text-muted">Tools to help you stay in control of your play.</p>

      {data?.selfExcluded && (
        <div className="mb-5 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Your account is currently self-excluded{data.selfExcludedUntil ? ` until ${data.selfExcludedUntil}` : " permanently"}.
            Contact support if you believe this is an error.
          </span>
        </div>
      )}

      <Card className="mb-5">
        <CardHeader>
          <CardTitle>Limits</CardTitle>
        </CardHeader>
        <CardContent className="pt-3">
          <form onSubmit={saveLimits} className="space-y-4">
            <Input label="Daily deposit limit (GC/SC)" type="number" value={depositLimit} onChange={(e) => setDepositLimit(e.target.value)} placeholder="No limit" />
            <Input label="Daily wager limit" type="number" value={wagerLimit} onChange={(e) => setWagerLimit(e.target.value)} placeholder="No limit" />
            <Input label="Session time limit (minutes)" type="number" value={sessionLimit} onChange={(e) => setSessionLimit(e.target.value)} placeholder="No limit" />
            <Button type="submit" loading={saving}>
              Save limits
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="mb-5">
        <CardHeader>
          <CardTitle>Cooling-off period</CardTitle>
        </CardHeader>
        <CardContent className="pt-3">
          <p className="mb-3 text-xs text-text-muted">
            Temporarily lock yourself out of play. Your account reactivates automatically once the period ends.
          </p>
          <div className="flex items-end gap-2">
            <Input label="Days" type="number" min={1} value={coolOffDays} onChange={(e) => setCoolOffDays(e.target.value)} />
            <Button variant="secondary" onClick={startCoolOff} loading={coolingOff}>
              Start cooling-off
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-danger/30">
        <CardHeader>
          <CardTitle className="text-danger">Self-exclusion</CardTitle>
        </CardHeader>
        <CardContent className="pt-3">
          <p className="mb-3 text-xs text-text-muted">
            Self-exclusion blocks all play on Vaultline for the duration you choose, or permanently. This action{" "}
            <strong>cannot be undone through the product</strong> — reactivation requires contacting support.
          </p>
          <Button variant="danger" onClick={() => setExclusionModal(true)} disabled={data?.selfExcluded}>
            {data?.selfExcluded ? "Already self-excluded" : "Start self-exclusion"}
          </Button>
        </CardContent>
      </Card>

      <Modal open={exclusionModal} onClose={() => setExclusionModal(false)} title="Confirm self-exclusion">
        <div className="space-y-4">
          <p className="text-sm text-text-muted">
            This will immediately and irreversibly block your access to Vaultline for the period you select. This
            cannot be undone from within the product.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={exclusionPermanent}
              onChange={(e) => setExclusionPermanent(e.target.checked)}
            />
            Permanent self-exclusion
          </label>
          {!exclusionPermanent && (
            <Input
              label="Duration (days)"
              type="number"
              min={1}
              value={exclusionDuration}
              onChange={(e) => setExclusionDuration(e.target.value)}
            />
          )}
          <Input
            label='Type "EXCLUDE" to confirm'
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
          />
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setExclusionModal(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              disabled={confirmText !== "EXCLUDE"}
              loading={excluding}
              onClick={confirmSelfExclude}
            >
              Confirm self-exclusion
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
