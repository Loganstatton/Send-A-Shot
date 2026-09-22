import type { ComponentType, SVGProps } from "react";
import {
  Home,
  Dice,
  Gift,
  Users,
  User,
  Trophy,
  MessageCircle,
  Wallet,
  Shield,
} from "@/components/ui/icons";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

export interface NavLeaf {
  label: string;
  href: string;
  icon?: Icon;
  /** The `nav.*` feature-flag key gating this item, if any (see `/me`'s `featureFlags`). */
  flagKey?: string;
  /**
   * How to render this item while its `flagKey` is disabled (or not yet
   * known — logged out / still loading). 'hidden' (the default) leaves it
   * out of the menu entirely; 'coming-soon' shows a muted, non-navigating
   * row with a "Coming Soon" badge. Core categories a player would expect
   * to browse toward read better as a polished preview; niche/social
   * features can just be hidden until enabled — see lib/nav-config.ts for
   * the per-item judgment call (sprint item 10).
   */
  presentation?: "hidden" | "coming-soon";
}

export interface NavSection {
  label: string;
  icon: Icon;
  items: NavLeaf[];
}

/**
 * Resolves how a nav item should render for the current user, shared by
 * every nav surface (Sidebar, ProfileMenu, …) so the flag/presentation
 * rules only live in one place. Before the user object is known (logged
 * out / still loading) a flagged item is treated as disabled — the safe
 * default is never to show functionality that isn't real yet.
 */
export function resolveNavItem(item: NavLeaf, featureFlags: Record<string, boolean> | undefined) {
  if (!item.flagKey) return { visible: true, enabled: true } as const;
  const enabled = featureFlags?.[item.flagKey] ?? false;
  if (enabled) return { visible: true, enabled: true } as const;
  if (item.presentation === "coming-soon") return { visible: true, enabled: false } as const;
  return { visible: false, enabled: false } as const;
}

// Casino Visual Redesign sprint: Slots/Live Casino/Table Games/Game Shows
// now have real demo content (see backend/prisma/seed.ts's demo catalog)
// and their nav.* flags are enabled, so they're permanent primary
// categories now, not flag-gated previews — the flagKey/presentation
// mechanism stays in place for genuinely not-yet-built sections below.
export const NAV_TREE: NavSection[] = [
  {
    label: "Casino",
    icon: Dice,
    items: [
      { label: "Casino Home", href: "/casino" },
      { label: "Originals", href: "/casino/originals/dice" },
      { label: "Slots", href: "/casino/slots" },
      { label: "Live Casino", href: "/casino/live-casino" },
      { label: "Table Games", href: "/casino/table-games" },
      { label: "Game Shows", href: "/casino/game-shows" },
    ],
  },
  {
    label: "Rewards",
    icon: Gift,
    items: [
      { label: "Promotions", href: "/rewards/promotions" },
      { label: "Daily Bonus", href: "/rewards/daily-bonus" },
      { label: "VIP Club", href: "/rewards/vip-club" },
      // Niche, not-yet-built: hidden until there's real content behind them.
      { label: "Challenges", href: "/rewards/challenges", flagKey: "nav.challenges", presentation: "hidden" },
    ],
  },
  {
    label: "Social",
    icon: Users,
    items: [
      { label: "Live Activity", href: "/social/live-activity", icon: Users },
      {
        label: "Leaderboards",
        href: "/social/leaderboards",
        icon: Trophy,
        flagKey: "nav.leaderboards",
        presentation: "hidden",
      },
    ],
  },
  {
    label: "Account",
    icon: User,
    items: [
      { label: "Wallet", href: "/account/wallet" },
      { label: "Transactions", href: "/account/transactions" },
      { label: "Profile", href: "/account/profile" },
    ],
  },
];

/** Rendered separately, pinned to the bottom of the sidebar/drawer — not
 * part of the scrollable NAV_TREE sections. */
export const NAV_FOOTER: NavLeaf[] = [
  { label: "Responsible Play", href: "/account/responsible-play", icon: Shield },
  { label: "Support", href: "/account/support", icon: MessageCircle },
];

// The persistent mobile bottom bar — max 5 items (sprint item 24). Anything
// that doesn't fit one of these 5 primary destinations (Social/Live
// Activity/Leaderboards, Responsible Play, Support) now lives in the
// ProfileMenu instead of a 6th "More" tab.
export const MOBILE_NAV: NavLeaf[] = [
  { label: "Home", href: "/", icon: Home },
  { label: "Casino", href: "/casino", icon: Dice },
  { label: "Rewards", href: "/rewards/promotions", icon: Trophy },
  { label: "Wallet", href: "/account/wallet", icon: Wallet },
  { label: "Profile", href: "/account/profile", icon: User },
];
