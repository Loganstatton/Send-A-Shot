"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthCard } from "@/components/layout/AuthCard";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { api, ApiError } from "@/lib/api-client";
import { US_STATES } from "@/lib/us-states";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    email: "",
    username: "",
    password: "",
    dateOfBirth: "",
    stateOfRecord: "",
  });
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!agreed) {
      setError("You must confirm you're 18+ (or 21+ where required) and agree to the Terms and Sweepstakes Rules.");
      return;
    }
    setLoading(true);
    try {
      await api.post("/auth/register", form, { skipAuth: true });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "JURISDICTION_BLOCKED") {
          setError("Registration isn't currently available in your state of record.");
        } else if (err.code === "AGE_RESTRICTED") {
          setError("You must meet the minimum age requirement to register.");
        } else {
          setError(err.message);
        }
      } else {
        setError("Unable to register. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <AuthCard title="Check your inbox" subtitle="We've sent a verification link to your email.">
        <p className="text-sm text-text-muted">
          Verify your email to activate your account, then{" "}
          <Link href="/login" className="text-accent-sc hover:underline">
            sign in
          </Link>
          .
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Create your account" subtitle="Play with Gold Coins today — Sweeps Coins unlock where approved.">
      <form onSubmit={onSubmit} className="space-y-4">
        <Input label="Username" required value={form.username} onChange={(e) => set("username", e.target.value)} />
        <Input
          label="Email"
          type="email"
          required
          value={form.email}
          onChange={(e) => set("email", e.target.value)}
        />
        <Input
          label="Password"
          type="password"
          required
          minLength={8}
          value={form.password}
          onChange={(e) => set("password", e.target.value)}
          hint="At least 8 characters."
        />
        <Input
          label="Date of birth"
          type="date"
          required
          value={form.dateOfBirth}
          onChange={(e) => set("dateOfBirth", e.target.value)}
        />
        <Select
          label="State of record"
          required
          value={form.stateOfRecord}
          onChange={(e) => set("stateOfRecord", e.target.value)}
        >
          <option value="">Select a state</option>
          {US_STATES.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </Select>
        <label className="flex items-start gap-2 text-xs text-text-muted">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          <span>
            I confirm I meet the minimum age to play and agree to the{" "}
            <Link href="/legal/terms" className="text-accent-sc hover:underline">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/legal/sweepstakes-rules" className="text-accent-sc hover:underline">
              Sweepstakes Rules
            </Link>
            . No purchase necessary to play or win.
          </span>
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" className="w-full" loading={loading}>
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-accent-gc hover:underline">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
