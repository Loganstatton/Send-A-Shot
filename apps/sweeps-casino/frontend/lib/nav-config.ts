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
      { label: "Casino Home", href: "/" },
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
      { label: "Live Activity", href: "/social/live-activity" },
      { label: "Leaderboards", href: "/social/leaderboards", flagKey: "nav.leaderboards", presentation: "hidden" },
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

export const MOBILE_NAV: NavLeaf[] = [
  { label: "Home", href: "/", icon: Home },
  { label: "Casino", href: "/casino/originals/dice", icon: Dice },
  { label: "Rewards", href: "/rewards/promotions", icon: Trophy },
  { label: "Wallet", href: "/account/wallet", icon: Wallet },
  { label: "Profile", href: "/account/profile", icon: User },
];
