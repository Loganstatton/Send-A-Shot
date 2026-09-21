"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MOBILE_NAV, NAV_TREE } from "@/lib/nav-config";
import { Menu, X } from "@/components/ui/icons";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";

export function MobileNav() {
  const pathname = usePathname();
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
                "flex flex-col items-center gap-0.5 px-2 text-[10px] font-medium",
                isActive ? "text-accent-sc" : "text-text-muted"
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
          <div className="absolute inset-y-0 right-0 flex w-72 flex-col bg-surface p-4 shadow-2xl animate-fade-in">
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
                    {section.items.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setDrawerOpen(false)}
                        className="flex items-center justify-between rounded-lg px-2 py-2 text-sm text-text-muted hover:bg-surface-raised hover:text-text-primary"
                      >
                        {item.label}
                        {item.comingSoon && <Badge className="text-[9px]">Soon</Badge>}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
