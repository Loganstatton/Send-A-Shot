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
    // Translucent glass bar, not a solid banking-app tab strip: a soft
    // backdrop blur over the page content, a barely-there top hairline, and
    // — per spec item 5 — an active tab that reads as teal icon + label +
    // a subtle glow, inactive tabs a quiet neutral gray.
    <nav className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-center justify-around border-t border-white/[0.06] bg-surface/75 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
      {MOBILE_NAV.map((item) => {
        const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
        const Icon = item.icon!;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex min-w-[3.25rem] flex-col items-center gap-1 py-1.5 text-[10px] font-medium transition-colors duration-150",
              isActive ? "text-accent-sc" : "text-text-muted"
            )}
          >
            <span
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200 ease-snappy",
                isActive ? "bg-accent-sc/12 shadow-glow-sc" : "bg-transparent"
              )}
            >
              <Icon className="h-5 w-5" />
            </span>
            <span className={cn("transition-opacity", isActive ? "font-semibold opacity-100" : "opacity-80")}>
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
