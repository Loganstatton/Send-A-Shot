"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_TREE } from "@/lib/nav-config";
import { Home } from "@/components/ui/icons";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const pathname = usePathname();

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
                const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
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
                    {item.comingSoon && (
                      <Badge variant="neutral" className="text-[9px]">
                        Soon
                      </Badge>
                    )}
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
