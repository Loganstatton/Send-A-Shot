"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthCard } from "@/components/layout/AuthCard";
import { api, ApiError } from "@/lib/api-client";

function VerifyEmailBody() {
  const params = useSearchParams();
  const token = params.get("token");
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("This verification link is missing its token.");
      return;
    }
    api
      .post("/auth/verify-email", { token }, { skipAuth: true })
      .then(() => setStatus("success"))
      .catch((err) => {
        setStatus("error");
        setMessage(err instanceof ApiError ? err.message : "Verification failed.");
      });
  }, [token]);

  return (
    <AuthCard title="Email verification">
      {status === "loading" && <p className="text-sm text-text-muted">Verifying your email...</p>}
      {status === "success" && (
        <div className="space-y-3">
          <p className="text-sm text-success">Your email has been verified.</p>
          <Link href="/login" className="text-sm text-accent-sc hover:underline">
            Continue to sign in
          </Link>
        </div>
      )}
      {status === "error" && <p className="text-sm text-danger">{message}</p>}
    </AuthCard>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailBody />
    </Suspense>
  );
}
