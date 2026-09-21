// Vaultline's brand mark: a stylized "V" cut into a dark-metallic roundel
// with subtle vault-door geometry (the concentric arc + small "bolt" dots
// echo a vault door without literally drawing a bank vault), a teal rim
// highlight, and a small gold accent dot. Pure inline SVG — no image
// asset, no icon library — so it renders identically as a sidebar/topbar
// mark, a favicon (see app/icon.tsx), or anywhere else it's dropped in.
import type { SVGProps } from "react";

export function VaultlineLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <defs>
        <linearGradient id="vl-metal" x1="4" y1="4" x2="36" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#2a2e37" />
          <stop offset="55%" stopColor="#15171c" />
          <stop offset="100%" stopColor="#0a0b0d" />
        </linearGradient>
        <linearGradient id="vl-v" x1="8" y1="12" x2="32" y2="12" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="rgb(var(--color-accent-sc))" />
          <stop offset="100%" stopColor="#e8f6f4" />
        </linearGradient>
      </defs>

      <rect x="1" y="1" width="38" height="38" rx="10" fill="url(#vl-metal)" />
      <rect x="1" y="1" width="38" height="38" rx="10" stroke="rgb(var(--color-accent-sc) / 0.35)" strokeWidth="1" />

      {/* Vault-door hint: a partial concentric arc + hinge/bolt dots. */}
      <circle cx="20" cy="20" r="14.5" stroke="rgb(var(--color-accent-sc) / 0.16)" strokeWidth="1" fill="none" />
      <circle cx="20" cy="6.5" r="1.1" fill="rgb(var(--color-accent-sc) / 0.4)" />
      <circle cx="20" cy="33.5" r="1.1" fill="rgb(var(--color-accent-sc) / 0.4)" />

      {/* The V. */}
      <path d="M10.5 11 L20 27 L29.5 11" stroke="url(#vl-v)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />

      {/* Small gold accent. */}
      <circle cx="30.5" cy="10.5" r="2.1" fill="rgb(var(--color-accent-gc))" />
    </svg>
  );
}
