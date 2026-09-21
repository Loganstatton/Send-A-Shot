"use client";

import { useState } from "react";
import Link from "next/link";
import { AuthCard } from "@/components/layout/AuthCard";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api-client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email }, { skipAuth: true });
    } finally {
      setLoading(false);
      setSent(true);
    }
  }

  if (sent) {
    return (
      <AuthCard title="Check your email" subtitle="If that address matches an account, we've sent a reset link.">
        <Link href="/login" className="text-sm text-accent-sc hover:underline">
          Back to sign in
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Reset your password" subtitle="We'll email you a link to set a new password.">
      <form onSubmit={onSubmit} className="space-y-4">
        <Input label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button type="submit" className="w-full" loading={loading}>
          Send reset link
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-text-muted">
        <Link href="/login" className="text-accent-sc hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthCard>
  );
}
