"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_TREE, type NavLeaf } from "@/lib/nav-config";
import { Home } from "@/components/ui/icons";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/lib/stores/auth-store";

/**
 * Resolves how a nav item should render for the current user.
 * Before the user object is known (logged out / still loading) a flagged
 * item is treated as disabled — the safe default is never to show
 * functionality that isn't real yet.
 */
function resolveNavItem(item: NavLeaf, featureFlags: Record<string, boolean> | undefined) {
  if (!item.flagKey) return { visible: true, enabled: true } as const;
  const enabled = featureFlags?.[item.flagKey] ?? false;
  if (enabled) return { visible: true, enabled: true } as const;
  if (item.presentation === "coming-soon") return { visible: true, enabled: false } as const;
  return { visible: false, enabled: false } as const;
}

export function Sidebar() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);

  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-surface/60 lg:flex">
      <div className="flex h-16 items-center gap-2 px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent-gc to-accent-sc text-sm font-bold text-bg">
          V
        </span>
        <span className="text-lg font-bold tracking-tight">Vaultline</span>
      </div>

      <nav className="no-scrollbar flex-1 overflow-y-auto px-3 pb-6">
        <Link
          href="/"
          className={cn(
            "mb-3 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            pathname === "/" ? "bg-surface-raised text-text-primary" : "text-text-muted hover:bg-surface-raised hover:text-text-primary"
          )}
        >
          <Home className="h-4 w-4" />
          Home
        </Link>

        {NAV_TREE.map((section) => (
          <div key={section.label} className="mb-5">
            <div className="mb-1.5 flex items-center gap-2 px-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
              <section.icon className="h-3.5 w-3.5" />
              {section.label}
            </div>
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const { visible, enabled } = resolveNavItem(item, user?.featureFlags);
                if (!visible) return null;
                const isActive = pathname === item.href || pathname.startsWith(item.href + "/");

                if (!enabled) {
                  return (
                    <span
                      key={item.href}
                      aria-disabled="true"
                      className="flex cursor-not-allowed items-center justify-between rounded-lg px-3 py-2 text-sm text-text-muted/50"
                    >
                      {item.label}
                      <Badge variant="neutral" className="text-[9px]">
                        Coming Soon
                      </Badge>
                    </span>
                  );
                }

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors",
                      isActive
                        ? "bg-surface-raised font-medium text-text-primary"
                        : "text-text-muted hover:bg-surface-raised hover:text-text-primary"
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
