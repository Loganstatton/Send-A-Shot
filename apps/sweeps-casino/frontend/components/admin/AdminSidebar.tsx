"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_NAV } from "@/lib/admin-nav";
import { cn } from "@/lib/utils";
import { Shield } from "@/components/ui/icons";

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-border bg-surface/60 md:flex">
      <div className="flex h-16 items-center gap-2 px-5">
        <Shield className="h-5 w-5 text-accent-sc" />
        <span className="text-sm font-bold tracking-tight">Vaultline Admin</span>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-6">
        {ADMIN_NAV.map((item) => {
          const isActive = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "mb-0.5 flex items-center rounded-lg px-3 py-2 text-sm transition-colors",
                isActive ? "bg-surface-raised font-medium text-text-primary" : "text-text-muted hover:bg-surface-raised hover:text-text-primary"
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-border p-3">
        <Link href="/" className="text-xs text-text-muted hover:text-text-primary">
          ← Back to player app
        </Link>
      </div>
    </aside>
  );
}
