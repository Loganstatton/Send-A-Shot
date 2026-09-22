"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MOBILE_NAV } from "@/lib/nav-config";
import { cn } from "@/lib/utils";

/**
 * Persistent mobile bottom bar — exactly 5 destinations (sprint item 24).
 * There's no "More" drawer here any more: everything that used to live
 * behind it (Social/Live Activity/Leaderboards, Responsible Play, Support)
 * now lives in ProfileMenu, which is reachable from the Topbar at every
 * breakpoint including mobile. If a future item needs feature-flag gating,
 * reuse `resolveNavItem` from lib/nav-config.ts the way Sidebar does.
 */
export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex h-14 items-center justify-around border-t border-border bg-surface/90 backdrop-blur-md lg:hidden">
      {MOBILE_NAV.map((item) => {
        const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
        const Icon = item.icon!;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-col items-center gap-0.5 px-2 text-[10px] font-medium transition-colors",
              isActive ? "text-accent-sc" : "text-text-muted"
            )}
          >
            <span
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full transition-shadow",
                isActive && "shadow-glow-sc"
              )}
            >
              <Icon className="h-5 w-5" />
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
