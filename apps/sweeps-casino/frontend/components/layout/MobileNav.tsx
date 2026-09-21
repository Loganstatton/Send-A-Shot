"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MOBILE_NAV, NAV_TREE, NAV_FOOTER, type NavLeaf } from "@/lib/nav-config";
import { Menu, X } from "@/components/ui/icons";
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

export function MobileNav() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-center justify-around border-t border-border bg-surface/95 backdrop-blur lg:hidden">
        {MOBILE_NAV.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          const Icon = item.icon!;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-0.5 px-2 text-[10px] font-medium transition-colors",
                isActive && "text-accent-sc drop-shadow-[0_0_6px_rgb(var(--color-accent-sc)/0.6)]",
                !isActive && "text-text-muted"
              )}
            >
              <Icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex flex-col items-center gap-0.5 px-2 text-[10px] font-medium text-text-muted"
        >
          <Menu className="h-5 w-5" />
          More
        </button>
      </nav>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setDrawerOpen(false)} />
          <div className="absolute inset-y-0 right-0 flex w-72 flex-col bg-surface p-4 shadow-2xl animate-slide-in-right">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-lg font-bold">Menu</span>
              <button onClick={() => setDrawerOpen(false)} className="rounded-md p-1.5 hover:bg-surface-raised">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {NAV_TREE.map((section) => (
                <div key={section.label} className="mb-5">
                  <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                    <section.icon className="h-3.5 w-3.5" />
                    {section.label}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {section.items.map((item) => {
                      const { visible, enabled } = resolveNavItem(item, user?.featureFlags);
                      if (!visible) return null;

                      if (!enabled) {
                        return (
                          <span
                            key={item.href}
                            aria-disabled="true"
                            className="flex cursor-not-allowed items-center justify-between rounded-lg px-2 py-2 text-sm text-text-muted/50"
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
                          onClick={() => setDrawerOpen(false)}
                          className="flex items-center justify-between rounded-lg px-2 py-2 text-sm text-text-muted hover:bg-surface-raised hover:text-text-primary"
                        >
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 border-t border-border pt-3">
              {NAV_FOOTER.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setDrawerOpen(false)}
                    className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-xs text-text-muted hover:bg-surface-raised hover:text-text-primary"
                  >
                    {Icon && <Icon className="h-3.5 w-3.5" />}
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
