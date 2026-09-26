"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dice, Reels, Cards, Users, Trophy, Star, Clock } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import type { ComponentType, SVGProps } from "react";

interface CategoryChip {
  label: string;
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

// Every href here resolves to a real route (verified against
// app/(main)/casino/* and app/(main)/rewards/*). "Popular", "New Games" and
// "Jackpots" have no dedicated browse page yet — the "Popular Now" and
// "Jackpots" rails right below the hero already surface that content, so
// those are intentionally left out rather than linking somewhere broken or
// pointing back at "/".
const CATEGORIES: CategoryChip[] = [
  { label: "Originals", href: "/casino/originals/dice", icon: Dice },
  { label: "Slots", href: "/casino/slots", icon: Reels },
  { label: "Table Games", href: "/casino/table-games", icon: Cards },
  { label: "Live Casino", href: "/casino/live-casino", icon: Users },
  { label: "Game Shows", href: "/casino/game-shows", icon: Trophy },
  { label: "Favorites", href: "/casino/favorites", icon: Star },
  { label: "Recent", href: "/casino/recently-played", icon: Clock },
];

export function CategoryBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Game categories"
      className="no-scrollbar flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 lg:px-6"
    >
      {CATEGORIES.map(({ label, href, icon: Icon }) => {
        const isActive = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex h-10 shrink-0 snap-start items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-xs font-semibold transition-colors sm:h-11 sm:text-sm",
              isActive
                ? "border-accent-gc/40 bg-accent-gc/12 text-accent-gc"
                : "border-border/70 bg-surface/60 text-text-muted hover:border-border hover:text-text-primary"
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
