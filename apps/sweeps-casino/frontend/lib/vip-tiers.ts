// Maps the 10-rank VIP ladder (backend VIP_LADDER, see
// backend/prisma/seed.ts) onto the 7 CSS "tier metal" tokens defined in
// styles/globals.css / tailwind.config.ts (Starter, Bronze, Silver, Gold,
// Platinum, Diamond, Elite). The four Platinum sub-ranks (5-8: "Platinum
// I"-"Platinum IV") all collapse onto the single `platinum` tier treatment
// — their roman-numeral suffix (already part of `name` from the API)
// differentiates them textually.
//
// Fields below use complete, literal Tailwind class strings (not built via
// string interpolation) so Tailwind's content scanner — which matches raw
// text, not JS structure — picks them all up even though they're accessed
// through this lookup table.

export type TierKey = "starter" | "bronze" | "silver" | "gold" | "platinum" | "diamond" | "elite";

export interface TierStyle {
  key: TierKey;
  /** Raw CSS custom-property references (RGB triplets) — feed into
   *  `.bg-tier-metal`'s --tier/--tier-hi inline vars, or into a manual
   *  `rgb(${cssVar} / alpha)` string for one-off inline effects. */
  cssVar: string;
  cssVarHi: string;
  /** Flat text color. Elite's base metal is near-black, so it (and only
   *  it) uses its bright highlight token for legible text/borders. */
  text: string;
  /** Border at ~30% opacity, for card/chip outlines. */
  borderSoft: string;
  /** Background wash at ~10% opacity. */
  bgSoft: string;
  /** Solid fill, for small tier dots/swatches. */
  dot: string;
}

const STYLES: Record<TierKey, TierStyle> = {
  starter: {
    key: "starter",
    cssVar: "var(--color-tier-starter)",
    cssVarHi: "var(--color-tier-starter-hi)",
    text: "text-tier-starter",
    borderSoft: "border-tier-starter/30",
    bgSoft: "bg-tier-starter/10",
    dot: "bg-tier-starter",
  },
  bronze: {
    key: "bronze",
    cssVar: "var(--color-tier-bronze)",
    cssVarHi: "var(--color-tier-bronze-hi)",
    text: "text-tier-bronze",
    borderSoft: "border-tier-bronze/30",
    bgSoft: "bg-tier-bronze/10",
    dot: "bg-tier-bronze",
  },
  silver: {
    key: "silver",
    cssVar: "var(--color-tier-silver)",
    cssVarHi: "var(--color-tier-silver-hi)",
    text: "text-tier-silver",
    borderSoft: "border-tier-silver/30",
    bgSoft: "bg-tier-silver/10",
    dot: "bg-tier-silver",
  },
  gold: {
    key: "gold",
    cssVar: "var(--color-tier-gold)",
    cssVarHi: "var(--color-tier-gold-hi)",
    text: "text-tier-gold",
    borderSoft: "border-tier-gold/30",
    bgSoft: "bg-tier-gold/10",
    dot: "bg-tier-gold",
  },
  platinum: {
    key: "platinum",
    cssVar: "var(--color-tier-platinum)",
    cssVarHi: "var(--color-tier-platinum-hi)",
    text: "text-tier-platinum",
    borderSoft: "border-tier-platinum/30",
    bgSoft: "bg-tier-platinum/10",
    dot: "bg-tier-platinum",
  },
  diamond: {
    key: "diamond",
    cssVar: "var(--color-tier-diamond)",
    cssVarHi: "var(--color-tier-diamond-hi)",
    text: "text-tier-diamond",
    borderSoft: "border-tier-diamond/30",
    bgSoft: "bg-tier-diamond/10",
    dot: "bg-tier-diamond",
  },
  elite: {
    key: "elite",
    cssVar: "var(--color-tier-elite)",
    cssVarHi: "var(--color-tier-elite-hi)",
    text: "text-tier-elite-hi",
    borderSoft: "border-tier-elite-hi/30",
    bgSoft: "bg-tier-elite-hi/10",
    dot: "bg-tier-elite",
  },
};

/** Maps a VIP ladder rank (1-10) to one of the 7 tier "materials". Ranks
 * 5-8 (Platinum I-IV) all collapse onto `platinum`. */
export function tierKeyForRank(rankOrder: number): TierKey {
  if (rankOrder <= 1) return "starter";
  if (rankOrder === 2) return "bronze";
  if (rankOrder === 3) return "silver";
  if (rankOrder === 4) return "gold";
  if (rankOrder >= 5 && rankOrder <= 8) return "platinum";
  if (rankOrder === 9) return "diamond";
  return "elite";
}

export function tierStyleForRank(rankOrder: number): TierStyle {
  return STYLES[tierKeyForRank(rankOrder)];
}
