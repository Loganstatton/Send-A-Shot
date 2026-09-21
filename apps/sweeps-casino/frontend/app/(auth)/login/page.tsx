"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthCard } from "@/components/layout/AuthCard";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api-client";
import { useAuthStore } from "@/lib/stores/auth-store";
import { friendlyErrorMessage } from "@/lib/error-messages";

interface LoginResponse {
  accessToken?: string;
  challenge?: "TOTP";
  challengeToken?: string;
}

export default function LoginPage() {
  const router = useRouter();
  const loginWithToken = useAuthStore((s) => s.loginWithToken);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [challenge, setChallenge] = useState<{ token: string } | null>(null);
  const [code, setCode] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.post<LoginResponse>("/auth/login", { email, password }, { skipAuth: true });
      if (res.challenge === "TOTP" && res.challengeToken) {
        setChallenge({ token: res.challengeToken });
        setLoading(false);
        return;
      }
      if (res.accessToken) {
        await loginWithToken(res.accessToken);
        router.push("/");
      }
    } catch (err) {
      setError(friendlyErrorMessage(err, "Unable to sign in. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit2fa(e: React.FormEvent) {
    e.preventDefault();
    if (!challenge) return;
    setError(null);
    setLoading(true);
    try {
      const res = await api.post<LoginResponse>(
        "/auth/login/2fa",
        { challengeToken: challenge.token, code },
        { skipAuth: true }
      );
      if (res.accessToken) {
        await loginWithToken(res.accessToken);
        router.push("/");
      }
    } catch (err) {
      setError(friendlyErrorMessage(err, "Invalid code."));
    } finally {
      setLoading(false);
    }
  }

  if (challenge) {
    return (
      <AuthCard title="Two-factor verification" subtitle="Enter the 6-digit code from your authenticator app.">
        <form onSubmit={onSubmit2fa} className="space-y-4">
          <Input label="Verification code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} autoFocus />
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" className="w-full" loading={loading}>
            Verify
          </Button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Welcome back" subtitle="Sign in to keep playing.">
      <form onSubmit={onSubmit} className="space-y-4">
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-xs text-accent-sc hover:underline">
            Forgot password?
          </Link>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" className="w-full" loading={loading}>
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-text-muted">
        New to Vaultline?{" "}
        <Link href="/register" className="font-medium text-accent-gc hover:underline">
          Create an account
        </Link>
      </p>
    </AuthCard>
  );
}
