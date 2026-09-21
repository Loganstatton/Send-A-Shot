"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { MobileNav } from "@/components/layout/MobileNav";
import { ActivityPanel } from "@/components/layout/ActivityPanel";
import { useAuthStore } from "@/lib/stores/auth-store";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const status = useAuthStore((s) => s.status);
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  if (status === "idle" || status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-sc border-t-transparent" />
      </div>
    );
  }

  if (status === "unauthenticated") {
    return null;
  }

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <div className="flex flex-1">
          <main className="min-w-0 flex-1 pb-20 lg:pb-0">{children}</main>
          <ActivityPanel collapsed={panelCollapsed} onToggle={() => setPanelCollapsed((v) => !v)} />
        </div>
      </div>
      <MobileNav />
    </div>
  );
}
