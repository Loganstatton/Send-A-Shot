"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CurrencySwitcher } from "@/components/wallet/CurrencySwitcher";
import { BalancePill } from "@/components/wallet/BalancePill";
import { WalletModal } from "@/components/wallet/WalletModal";
import { NotificationsBell } from "@/components/layout/NotificationsBell";
import { ProfileMenu } from "@/components/layout/ProfileMenu";
import { VaultlineLogo } from "@/components/ui/VaultlineLogo";
import { Search } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

// Compact desktop top-nav shortcuts. The full tree still lives in the
// sidebar — this is just the handful of top-level links a player expects
// to reach without opening it, per the "compact top navigation" spec.
const TOP_LINKS = [
  { label: "Casino", href: "/" },
  { label: "Originals", href: "/casino/originals/dice" },
  { label: "Promotions", href: "/rewards/promotions" },
  { label: "VIP", href: "/rewards/vip-club" },
];

export function Topbar() {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [walletOpen, setWalletOpen] = useState(false);

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim()) router.push(`/casino/search?q=${encodeURIComponent(query.trim())}`);
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border bg-bg/90 px-4 backdrop-blur lg:px-6">
      <Link href="/" className="flex shrink-0 items-center gap-2 lg:hidden">
        <VaultlineLogo className="h-8 w-8" />
      </Link>

      <nav className="hidden shrink-0 items-center gap-4 lg:flex">
        {TOP_LINKS.map((link) => {
          const isActive = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "text-sm font-medium transition-colors",
                isActive ? "text-text-primary" : "text-text-muted hover:text-text-primary"
              )}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>

      <form onSubmit={onSearchSubmit} className="hidden max-w-sm flex-1 md:block">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search games..."
            className="w-full rounded-full border border-border bg-surface-raised py-2 pl-9 pr-3 text-sm outline-none focus:border-accent-sc"
          />
        </div>
      </form>

      <div className="flex flex-1 items-center justify-end gap-1.5 sm:gap-3">
        {/* The balance itself opens the wallet modal — the live number is
            always visible (sprint item 25: no separate icon button needed
            just to see or reach it), so there's no redundant circular
            "Wallet" button sitting next to it any more. */}
        <button onClick={() => setWalletOpen(true)} aria-label="Open wallet" className="rounded-full">
          <BalancePill alwaysVisible />
        </button>
        {/* Below 360px the topbar has no room for GC/SC + bell + profile
            without overflowing (measured at 320px). Currency is still
            reachable via the balance/wallet modal and bottom nav. */}
        <div className="max-[359px]:hidden">
          <CurrencySwitcher />
        </div>
        <NotificationsBell />
        <ProfileMenu />
      </div>

      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
    </header>
  );
}
