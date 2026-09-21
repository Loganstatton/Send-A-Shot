import type { ComponentType, SVGProps } from "react";
import {
  Home,
  Dice,
  Gift,
  Users,
  User,
  Star,
  Trophy,
  MessageCircle,
  Wallet,
  Settings,
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

export const NAV_TREE: NavSection[] = [
  {
    label: "Casino",
    icon: Dice,
    items: [
      { label: "Originals", href: "/casino/originals/dice" },
      // Core casino categories players expect to browse toward: a
      // polished "Coming Soon" preview reads better than as if the menu
      // item never existed.
      { label: "Slots", href: "/casino/slots", flagKey: "nav.slots", presentation: "coming-soon" },
      { label: "Live Casino", href: "/casino/live-casino", flagKey: "nav.live_casino", presentation: "coming-soon" },
      // Niche/less-expected categories: hide entirely until enabled rather
      // than filling the menu with more "Soon" badges.
      { label: "Table Games", href: "/casino/table-games", flagKey: "nav.table_games", presentation: "hidden" },
      { label: "Game Shows", href: "/casino/game-shows", flagKey: "nav.game_shows", presentation: "hidden" },
      { label: "Favorites", href: "/casino/favorites" },
      { label: "Recently Played", href: "/casino/recently-played" },
    ],
  },
  {
    label: "Rewards",
    icon: Gift,
    items: [
      { label: "Promotions", href: "/rewards/promotions" },
      { label: "Daily Bonus", href: "/rewards/daily-bonus" },
      { label: "VIP Club", href: "/rewards/vip-club" },
      { label: "Challenges", href: "/rewards/challenges", flagKey: "nav.challenges", presentation: "hidden" },
      { label: "Raffles", href: "/rewards/raffles", flagKey: "nav.raffles", presentation: "hidden" },
    ],
  },
  {
    label: "Social",
    icon: Users,
    items: [
      { label: "Chat", href: "/social/chat", flagKey: "nav.chat", presentation: "hidden" },
      { label: "Leaderboards", href: "/social/leaderboards", flagKey: "nav.leaderboards", presentation: "hidden" },
    ],
  },
  {
    label: "Account",
    icon: User,
    items: [
      { label: "Wallet", href: "/account/wallet" },
      { label: "Transactions", href: "/account/transactions" },
      { label: "Redemptions", href: "/account/redemptions" },
      { label: "Profile", href: "/account/profile" },
      { label: "Responsible Play", href: "/account/responsible-play" },
      { label: "Security", href: "/account/security" },
      { label: "Support", href: "/account/support" },
    ],
  },
];

export const MOBILE_NAV: NavLeaf[] = [
  { label: "Home", href: "/", icon: Home },
  { label: "Casino", href: "/casino/originals/dice", icon: Dice },
  { label: "Rewards", href: "/rewards/promotions", icon: Trophy },
  { label: "Wallet", href: "/account/wallet", icon: Wallet },
  { label: "Profile", href: "/account/profile", icon: User },
];
