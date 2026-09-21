"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { useAuthStore } from "@/lib/stores/auth-store";
import { api, ApiError } from "@/lib/api-client";

/**
 * Separate route tree, separate RBAC gate. This layout never renders any
 * player nav — see components/layout/Sidebar.tsx, which has no admin link.
 * Access is verified by actually calling an admin-only endpoint (not by
 * trusting a client-side flag), so a non-admin JWT reliably bounces to "/".
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const authStatus = useAuthStore((s) => s.status);
  const [gate, setGate] = useState<"checking" | "allowed" | "denied">("checking");

  useEffect(() => {
    if (authStatus === "idle" || authStatus === "loading") return;
    if (authStatus === "unauthenticated") {
      router.replace("/login");
      return;
    }
    let cancelled = false;
    api
      .get("/admin/dashboard")
      .then(() => !cancelled && setGate("allowed"))
      .catch((err) => {
        if (cancelled) return;
        setGate("denied");
        if (err instanceof ApiError && err.status === 403) {
          router.replace("/");
        } else {
          router.replace("/");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authStatus, router]);

  if (gate !== "allowed") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-sc border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-bg">
      <AdminSidebar />
      <main className="min-w-0 flex-1 overflow-x-hidden">{children}</main>
    </div>
  );
}
