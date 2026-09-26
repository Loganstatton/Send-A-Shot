export interface AdminNavItem {
  label: string;
  href: string;
}

// This nav tree is only ever rendered inside app/admin/layout.tsx — never
// linked from the player-facing Sidebar/MobileNav, per docs/04.
export const ADMIN_NAV: AdminNavItem[] = [
  { label: "Dashboard", href: "/admin" },
  { label: "Users", href: "/admin/users" },
  { label: "Ledger", href: "/admin/ledger" },
  { label: "Games", href: "/admin/games" },
  { label: "Promotions", href: "/admin/promotions" },
  { label: "VIP", href: "/admin/vip" },
  { label: "Compliance", href: "/admin/compliance" },
  { label: "KYC Queue", href: "/admin/kyc" },
  { label: "Risk Queue", href: "/admin/risk" },
  { label: "Redemptions", href: "/admin/redemptions" },
  { label: "Roles", href: "/admin/roles" },
  { label: "Audit Log", href: "/admin/audit-log" },
];
