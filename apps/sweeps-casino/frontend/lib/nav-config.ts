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
  comingSoon?: boolean;
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
      { label: "Slots", href: "/casino/slots", comingSoon: true },
      { label: "Live Casino", href: "/casino/live-casino", comingSoon: true },
      { label: "Table Games", href: "/casino/table-games", comingSoon: true },
      { label: "Game Shows", href: "/casino/game-shows", comingSoon: true },
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
      { label: "Challenges", href: "/rewards/challenges", comingSoon: true },
      { label: "Raffles", href: "/rewards/raffles", comingSoon: true },
    ],
  },
  {
    label: "Social",
    icon: Users,
    items: [
      { label: "Chat", href: "/social/chat", comingSoon: true },
      { label: "Leaderboards", href: "/social/leaderboards", comingSoon: true },
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
