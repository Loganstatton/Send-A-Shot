"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Shield } from "@/components/ui/icons";
import { VaultlineLogo } from "@/components/ui/VaultlineLogo";
import { api } from "@/lib/api-client";
import { friendlyErrorMessage } from "@/lib/error-messages";

interface VerifyResult {
  result: Record<string, unknown>;
  hash: string;
  matchesServerSeedHash?: boolean;
}

export default function ProvablyFairPage() {
  const [form, setForm] = useState({ serverSeed: "", clientSeed: "", nonce: "0", game: "dice" });
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await api.post<VerifyResult>(
        "/provably-fair/verify",
        { ...form, nonce: parseInt(form.nonce, 10) },
        { skipAuth: true }
      );
      setResult(res);
    } catch (err) {
      setError(friendlyErrorMessage(err, "Verification failed — check your inputs."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg px-4 py-10">
      <div className="mx-auto max-w-xl">
        <Link href="/" className="mb-6 flex items-center gap-2">
          <VaultlineLogo className="h-8 w-8" />
          <span className="text-lg font-bold">Vaultline</span>
        </Link>

        <div className="mb-6 flex items-center gap-2">
          <Shield className="h-5 w-5 text-accent-sc" />
          <h1 className="text-xl font-bold text-text-primary">Provably Fair Verification</h1>
        </div>
        <p className="mb-6 text-sm text-text-muted">
          Independently recompute any past Vaultline Originals round from its revealed server seed, client seed, and
          nonce. This tool works for anyone — no account required.
        </p>

        <Card>
          <CardContent className="p-5">
            <form onSubmit={onVerify} className="space-y-4">
              <Select label="Game" value={form.game} onChange={(e) => set("game", e.target.value)}>
                <option value="dice">Dice</option>
                <option value="mines">Mines</option>
                <option value="plinko">Plinko</option>
              </Select>
              <Input
                label="Server seed (revealed)"
                required
                value={form.serverSeed}
                onChange={(e) => set("serverSeed", e.target.value)}
                className="font-mono text-xs"
              />
              <Input
                label="Client seed"
                required
                value={form.clientSeed}
                onChange={(e) => set("clientSeed", e.target.value)}
                className="font-mono text-xs"
              />
              <Input
                label="Nonce"
                type="number"
                required
                value={form.nonce}
                onChange={(e) => set("nonce", e.target.value)}
              />
              {error && <p className="text-sm text-danger">{error}</p>}
              <Button type="submit" className="w-full" loading={loading}>
                Verify round
              </Button>
            </form>
          </CardContent>
        </Card>

        {result && (
          <Card className="mt-5">
            <CardContent className="space-y-3 p-5">
              <div>
                <p className="text-[11px] font-medium text-text-muted">HMAC hash</p>
                <p className="break-all rounded-md bg-surface-raised px-2.5 py-2 font-mono text-[11px]">
                  {result.hash}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-medium text-text-muted">Derived result</p>
                <pre className="overflow-x-auto rounded-md bg-surface-raised px-2.5 py-2 font-mono text-[11px]">
                  {JSON.stringify(result.result, null, 2)}
                </pre>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
