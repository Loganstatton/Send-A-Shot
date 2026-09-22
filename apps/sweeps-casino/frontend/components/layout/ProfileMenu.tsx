"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useCurrencyStore } from "@/lib/stores/currency-store";
import { useWalletStore } from "@/lib/stores/wallet-store";
import { NAV_TREE, NAV_FOOTER, resolveNavItem, type NavLeaf } from "@/lib/nav-config";
import { tierStyleForRank } from "@/lib/vip-tiers";
import { formatCoins, cn } from "@/lib/utils";
import { User, Settings, LogOut, ChevronDown } from "@/components/ui/icons";
import { Badge } from "@/components/ui/Badge";

// Social/Live Activity/Leaderboards used to live behind the mobile "More"
// drawer; Responsible Play/Support lived in the sidebar's pinned footer.
// Now that the bottom bar is capped at 5 primary destinations (sprint item
// 24), this menu — reachable from the Topbar at every breakpoint — is
// where all of it lives instead. Pulled straight from nav-config.ts so
// there's one source of truth for hrefs/flags.
const SOCIAL_ITEMS = NAV_TREE.find((s) => s.label === "Social")?.items ?? [];

export function ProfileMenu() {
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const active = useCurrencyStore((s) => s.active);
  const balances = useWalletStore((s) => s.balances);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function onLogout() {
    await logout();
    router.push("/login");
  }

  const balance = active === "GC" ? balances?.gc.balance : balances?.sc.balance;
  const tier = user?.vip ? tierStyleForRank(user.vip.level) : null;

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + "/");
  }

  function NavRow({ item }: { item: NavLeaf }) {
    const { visible, enabled } = resolveNavItem(item, user?.featureFlags);
    if (!visible) return null;
    const Icon = item.icon;
    const itemActive = isActive(item.href);

    if (!enabled) {
      return (
        <span
          aria-disabled="true"
          className="flex cursor-not-allowed items-center justify-between gap-2.5 rounded-lg px-4 py-2 text-sm text-text-muted/50"
        >
          <span className="flex items-center gap-2.5">
            {Icon && <Icon className="h-4 w-4" />}
            {item.label}
          </span>
          <Badge variant="neutral" className="text-[9px]">
            Coming Soon
          </Badge>
        </span>
      );
    }

    return (
      <Link
        href={item.href}
        onClick={() => setOpen(false)}
        className={cn(
          "flex items-center gap-2.5 rounded-lg px-4 py-2 text-sm transition-colors",
          itemActive
            ? "bg-surface-raised text-text-primary"
            : "text-text-muted hover:bg-surface-raised hover:text-text-primary"
        )}
      >
        {Icon && <Icon className={cn("h-4 w-4 shrink-0", itemActive && "text-accent-sc")} />}
        {item.label}
      </Link>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full bg-surface-raised py-1 pl-1 pr-2 text-sm hover:bg-surface-raised/70"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-accent-gc to-accent-sc text-xs font-bold text-bg">
          {user?.username?.[0]?.toUpperCase() ?? <User className="h-4 w-4 text-bg" />}
        </span>
        <span className="hidden max-w-[90px] truncate font-medium text-text-primary sm:inline">
          {user?.username ?? "Account"}
        </span>
        <ChevronDown className="hidden h-3.5 w-3.5 text-text-muted sm:inline" />
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-40 w-64 overflow-hidden rounded-xl border border-border bg-surface py-1.5 shadow-xl animate-fade-in">
          {/* Profile summary: name, VIP tier, current balance — all above
              the nav links (sprint item 40). */}
          <div className="flex items-center gap-3 px-4 pb-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-gc to-accent-sc text-sm font-bold text-bg">
              {user?.username?.[0]?.toUpperCase() ?? <User className="h-5 w-5 text-bg" />}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-text-primary">
                {user?.displayName || user?.username || "Account"}
              </p>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs">
                {tier && (
                  <>
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tier.dot)} />
                    <span className={cn("font-medium", tier.text)}>{user?.vip?.levelName}</span>
                    <span className="text-text-muted">·</span>
                  </>
                )}
                <span className={cn("font-mono font-semibold", active === "GC" ? "text-accent-gc" : "text-accent-sc")}>
                  {balance !== undefined ? formatCoins(balance) : "—"} {active}
                </span>
              </div>
            </div>
          </div>
          <div className="border-t border-border" />

          <div className="py-1.5">
            <NavRow item={{ label: "Profile", href: "/account/profile", icon: User }} />
            <NavRow item={{ label: "Security", href: "/account/security", icon: Settings }} />
          </div>

          {SOCIAL_ITEMS.length > 0 && (
            <>
              <div className="border-t border-border" />
              <div className="py-1.5">
                <p className="px-4 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  Community
                </p>
                {SOCIAL_ITEMS.map((item) => (
                  <NavRow key={item.href} item={item} />
                ))}
              </div>
            </>
          )}

          <div className="border-t border-border" />
          <div className="py-1.5">
            <p className="px-4 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
              Support
            </p>
            {NAV_FOOTER.map((item) => (
              <NavRow key={item.href} item={item} />
            ))}
          </div>

          <div className="border-t border-border" />
          <div className="pt-1.5">
            <button
              onClick={onLogout}
              className="flex w-full items-center gap-2.5 rounded-lg px-4 py-2 text-left text-sm text-danger hover:bg-surface-raised"
            >
              <LogOut className="h-4 w-4" /> Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
