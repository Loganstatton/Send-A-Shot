"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/stores/auth-store";
import { User, Settings, LogOut, ChevronDown } from "@/components/ui/icons";

export function ProfileMenu() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
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

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full border border-border bg-surface-raised py-1 pl-1 pr-2 text-sm hover:border-accent-sc/40"
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
        <div className="absolute right-0 top-[calc(100%+8px)] z-40 w-52 rounded-xl border border-border bg-surface py-1.5 shadow-xl animate-fade-in">
          <Link
            href="/account/profile"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-4 py-2 text-sm text-text-muted hover:bg-surface-raised hover:text-text-primary"
          >
            <User className="h-4 w-4" /> Profile
          </Link>
          <Link
            href="/account/security"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-4 py-2 text-sm text-text-muted hover:bg-surface-raised hover:text-text-primary"
          >
            <Settings className="h-4 w-4" /> Security
          </Link>
          <div className="my-1 border-t border-border" />
          <button
            onClick={onLogout}
            className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm text-danger hover:bg-surface-raised"
          >
            <LogOut className="h-4 w-4" /> Log out
          </button>
        </div>
      )}
    </div>
  );
}
