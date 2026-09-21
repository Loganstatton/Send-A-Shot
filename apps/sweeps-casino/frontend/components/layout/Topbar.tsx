"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CurrencySwitcher } from "@/components/wallet/CurrencySwitcher";
import { BalancePill } from "@/components/wallet/BalancePill";
import { WalletModal } from "@/components/wallet/WalletModal";
import { NotificationsBell } from "@/components/layout/NotificationsBell";
import { ProfileMenu } from "@/components/layout/ProfileMenu";
import { Search, Wallet } from "@/components/ui/icons";
import { Button } from "@/components/ui/Button";

export function Topbar() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [walletOpen, setWalletOpen] = useState(false);

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim()) router.push(`/casino/search?q=${encodeURIComponent(query.trim())}`);
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-bg/90 px-4 backdrop-blur lg:px-6">
      <Link href="/" className="flex shrink-0 items-center gap-2 lg:hidden">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent-gc to-accent-sc text-sm font-bold text-bg">
          V
        </span>
      </Link>

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

      <div className="flex flex-1 items-center justify-end gap-2 sm:gap-3">
        <BalancePill />
        <CurrencySwitcher />
        <button
          onClick={() => setWalletOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface-raised text-text-muted hover:text-text-primary"
          aria-label="Wallet"
        >
          <Wallet className="h-4 w-4" />
        </button>
        <NotificationsBell />
        <ProfileMenu />
      </div>

      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
    </header>
  );
}
