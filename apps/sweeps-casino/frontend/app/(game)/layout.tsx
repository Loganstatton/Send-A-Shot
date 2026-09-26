"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/stores/auth-store";

/**
 * Fullscreen game mode (Casino Visual Redesign sprint): a sibling route
 * group to (main), so pages here render WITHOUT the Sidebar/Topbar/
 * MobileNav/ActivityPanel shell — Next.js layouts nest by default, and
 * escaping a parent shell entirely requires living outside its route
 * group, not just a child layout inside it. Route groups (the
 * parenthesized segment) don't appear in the URL, so
 * app/(game)/casino/originals/[slug]/page.tsx still resolves to
 * /casino/originals/[slug], identically to before this moved out of
 * (main).
 *
 * (main)/layout.tsx's auth guard doesn't apply here since this is a
 * sibling, not a descendant — replicated below (same pattern, no
 * redundant hydrate() call — the root layout's AppProviders already
 * hydrates auth state once for every route group, this one included).
 */
export default function GameLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const status = useAuthStore((s) => s.status);

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

  return <div className="min-h-screen bg-bg">{children}</div>;
}
