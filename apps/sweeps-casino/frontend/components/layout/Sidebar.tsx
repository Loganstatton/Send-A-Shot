"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_TREE, NAV_FOOTER, type NavLeaf } from "@/lib/nav-config";
import { VaultlineLogo } from "@/components/ui/VaultlineLogo";
import { ChevronLeft, ChevronRight } from "@/components/ui/icons";
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

function isItemActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-surface/60 transition-[width] duration-200 ease-premium lg:flex",
        collapsed ? "w-[68px]" : "w-60"
      )}
    >
      <div className={cn("flex h-16 items-center gap-2", collapsed ? "justify-center px-2" : "px-5")}>
        <VaultlineLogo className="h-8 w-8 shrink-0" />
        {!collapsed && <span className="truncate text-lg font-bold tracking-tight">Vaultline</span>}
      </div>

      <nav className="no-scrollbar flex-1 overflow-y-auto px-3 pb-4">
        {NAV_TREE.map((section) => (
          <div key={section.label} className="mb-5">
            {!collapsed && (
              <div className="mb-1.5 flex items-center gap-2 px-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
                <section.icon className="h-3.5 w-3.5" />
                {section.label}
              </div>
            )}
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const { visible, enabled } = resolveNavItem(item, user?.featureFlags);
                if (!visible) return null;
                const isActive = isItemActive(pathname, item.href);

                if (!enabled) {
                  return collapsed ? null : (
                    <span
                      key={item.href}
                      aria-disabled="true"
                      title={item.label}
                      className="flex cursor-not-allowed items-center justify-between rounded-lg border-l-2 border-transparent px-3 py-2 text-sm text-text-muted/50"
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
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-r-lg border-l-2 py-2 text-sm transition-colors",
                      collapsed ? "justify-center px-0" : "justify-start px-3",
                      isActive
                        ? "border-accent-sc bg-surface-raised font-medium text-text-primary"
                        : "border-transparent text-text-muted hover:border-border hover:bg-surface-raised hover:text-text-primary"
                    )}
                  >
                    {collapsed ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-border px-3 py-3">
        {NAV_FOOTER.map((item) => {
          const isActive = isItemActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs transition-colors",
                collapsed && "justify-center px-0",
                isActive ? "text-text-primary" : "text-text-muted hover:text-text-primary"
              )}
            >
              {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
              {!collapsed && item.label}
            </Link>
          );
        })}
        <button
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary",
            collapsed && "justify-center px-0"
          )}
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
          {!collapsed && "Collapse"}
        </button>
      </div>
    </aside>
  );
}
