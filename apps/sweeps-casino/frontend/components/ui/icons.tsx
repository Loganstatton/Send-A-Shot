// Small dependency-free inline SVG icon set (no external icon package).
import { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
};

export const X = (p: IconProps) => (
  <svg {...base} {...p}><path d="M18 6 6 18M6 6l12 12" /></svg>
);
export const Search = (p: IconProps) => (
  <svg {...base} {...p}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
);
export const Bell = (p: IconProps) => (
  <svg {...base} {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
);
export const Wallet = (p: IconProps) => (
  <svg {...base} {...p}><path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" /><path d="M21 12a2 2 0 0 0-2-2h-4a2 2 0 0 0 0 4h4a2 2 0 0 0 2-2Z" /></svg>
);
export const ChevronDown = (p: IconProps) => (
  <svg {...base} {...p}><path d="m6 9 6 6 6-6" /></svg>
);
export const ChevronRight = (p: IconProps) => (
  <svg {...base} {...p}><path d="m9 18 6-6-6-6" /></svg>
);
export const ChevronLeft = (p: IconProps) => (
  <svg {...base} {...p}><path d="m15 18-6-6 6-6" /></svg>
);
export const Home = (p: IconProps) => (
  <svg {...base} {...p}><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M9 22V12h6v10" /></svg>
);
export const Dice = (p: IconProps) => (
  <svg {...base} {...p}><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1" fill="currentColor" /><circle cx="16" cy="16" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /></svg>
);
export const Gift = (p: IconProps) => (
  <svg {...base} {...p}><rect x="3" y="8" width="18" height="13" rx="1" /><path d="M12 8v13M3 12h18M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5" /></svg>
);
export const Users = (p: IconProps) => (
  <svg {...base} {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
);
export const User = (p: IconProps) => (
  <svg {...base} {...p}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
);
export const Star = (p: IconProps) => (
  <svg {...base} {...p}><path d="M12 2 15.09 8.26 22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z" /></svg>
);
export const StarFilled = (p: IconProps) => (
  <svg {...base} fill="currentColor" {...p}><path d="M12 2 15.09 8.26 22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z" /></svg>
);
export const Coins = (p: IconProps) => (
  <svg {...base} {...p}><ellipse cx="9" cy="6" rx="7" ry="3" /><path d="M2 6v6c0 1.66 3.13 3 7 3s7-1.34 7-3V6" /><path d="M2 12v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6" /></svg>
);
export const Shield = (p: IconProps) => (
  <svg {...base} {...p}><path d="M12 2 3 6v6c0 5.25 3.75 9.75 9 11 5.25-1.25 9-5.75 9-11V6Z" /></svg>
);
export const Trophy = (p: IconProps) => (
  <svg {...base} {...p}><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0Z" /><path d="M17 4h3a3 3 0 0 1-3 5M7 4H4a3 3 0 0 0 3 5" /></svg>
);
export const MessageCircle = (p: IconProps) => (
  <svg {...base} {...p}><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" /></svg>
);
export const Settings = (p: IconProps) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></svg>
);
export const LogOut = (p: IconProps) => (
  <svg {...base} {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>
);
export const Menu = (p: IconProps) => (
  <svg {...base} {...p}><path d="M4 6h16M4 12h16M4 18h16" /></svg>
);
export const Lock = (p: IconProps) => (
  <svg {...base} {...p}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
);
export const AlertTriangle = (p: IconProps) => (
  <svg {...base} {...p}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" /><path d="M12 9v4M12 17h.01" /></svg>
);
export const CheckCircle = (p: IconProps) => (
  <svg {...base} {...p}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="m22 4-10 10-3-3" /></svg>
);
export const ArrowRight = (p: IconProps) => (
  <svg {...base} {...p}><path d="M5 12h14M12 5l7 7-7 7" /></svg>
);
export const RefreshCw = (p: IconProps) => (
  <svg {...base} {...p}><path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" /></svg>
);
export const Eye = (p: IconProps) => (
  <svg {...base} {...p}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" /><circle cx="12" cy="12" r="3" /></svg>
);
export const EyeOff = (p: IconProps) => (
  <svg {...base} {...p}><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" /><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 11 7 11 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.52 13.52 0 0 0 1 12s4 7 11 7a10.44 10.44 0 0 0 5.39-1.61M1 1l22 22" /></svg>
);
export const Plus = (p: IconProps) => (
  <svg {...base} {...p}><path d="M12 5v14M5 12h14" /></svg>
);
export const Bomb = (p: IconProps) => (
  <svg {...base} {...p}><circle cx="11" cy="13" r="8" /><path d="m17 7 2-2m0 0 2 2m-2-2v4M14 4l1.5 1.5" /></svg>
);
export const Flag = (p: IconProps) => (
  <svg {...base} {...p}><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><path d="M4 22V15" /></svg>
);
export const Clock = (p: IconProps) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></svg>
);
export const Reels = (p: IconProps) => (
  <svg {...base} {...p}><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M8 4v16M16 4v16" /><circle cx="5" cy="9" r="0.6" fill="currentColor" /><circle cx="12" cy="13" r="0.6" fill="currentColor" /><circle cx="19" cy="9" r="0.6" fill="currentColor" /></svg>
);
export const Cards = (p: IconProps) => (
  <svg {...base} {...p}><rect x="2" y="6" width="13" height="16" rx="2" transform="rotate(-8 8.5 14)" /><rect x="9" y="4" width="13" height="16" rx="2" /></svg>
);
export const Chest = (p: IconProps) => (
  <svg {...base} {...p}><rect x="3" y="10" width="18" height="10" rx="2" /><path d="M3 10a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4" /><rect x="10" y="12" width="4" height="3" rx="0.5" fill="currentColor" /></svg>
);
