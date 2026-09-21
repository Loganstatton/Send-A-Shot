"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Shield, RefreshCw } from "@/components/ui/icons";
import { api } from "@/lib/api-client";
import { friendlyErrorMessage } from "@/lib/error-messages";
import type { SeedState } from "@/lib/types";
import { useToast } from "@/components/layout/Toast";

interface ProvablyFairPanelProps {
  seed: SeedState | null;
  loading: boolean;
  onRotated: (next: SeedState) => void;
}

export function ProvablyFairPanel({ seed, loading, onRotated }: ProvablyFairPanelProps) {
  const toast = useToast();
  const [clientSeedDraft, setClientSeedDraft] = useState(seed?.clientSeed ?? "");
  const [busy, setBusy] = useState(false);

  async function rotate() {
    setBusy(true);
    try {
      const next = await api.post<SeedState>("/casino/originals/seeds/rotate", {}, { idempotent: true });
      onRotated(next);
      toast.push("Seed rotated — previous server seed revealed.", "success");
    } catch (err) {
      toast.push(friendlyErrorMessage(err, "Could not rotate seed."), "danger");
    } finally {
      setBusy(false);
    }
  }

  async function saveClientSeed() {
    setBusy(true);
    try {
      const next = await api.patch<SeedState>("/casino/originals/seeds/client-seed", {
        clientSeed: clientSeedDraft,
      });
      onRotated(next);
      toast.push("Client seed updated.", "success");
    } catch (err) {
      toast.push(friendlyErrorMessage(err, "Could not update client seed."), "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-accent-sc" />
          Provably Fair
        </CardTitle>
        <Link href="/provably-fair" className="text-xs text-accent-sc hover:underline">
          Verify a round
        </Link>
      </CardHeader>
      <CardContent className="space-y-3 pt-3">
        {loading || !seed ? (
          <p className="text-xs text-text-muted">Loading seed state...</p>
        ) : (
          <>
            <div>
              <p className="text-[11px] font-medium text-text-muted">Hashed server seed</p>
              <p className="break-all rounded-md bg-surface-raised px-2.5 py-2 font-mono text-[11px] text-text-primary">
                {seed.serverSeedHash}
              </p>
            </div>
            <div className="flex items-end gap-2">
              <Input
                label="Client seed"
                value={clientSeedDraft}
                onChange={(e) => setClientSeedDraft(e.target.value)}
                className="font-mono text-xs"
              />
              <Button type="button" size="sm" variant="secondary" onClick={saveClientSeed} disabled={busy}>
                Save
              </Button>
            </div>
            <div className="flex items-center justify-between text-[11px] text-text-muted">
              <span>Nonce: {seed.nonce}</span>
              <Button type="button" size="sm" variant="outline" onClick={rotate} loading={busy}>
                <RefreshCw className="h-3.5 w-3.5" />
                Rotate seed
              </Button>
            </div>
            {seed.revealedServerSeed && (
              <div>
                <p className="text-[11px] font-medium text-text-muted">Previously revealed server seed</p>
                <p className="break-all rounded-md bg-surface-raised px-2.5 py-2 font-mono text-[11px] text-text-muted">
                  {seed.revealedServerSeed}
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
