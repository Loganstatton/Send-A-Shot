// Original, hand-authored CSS + inline-SVG artwork for promo/reward cards —
// same approach as originals-art.tsx (no external images, no copied
// casino/brand imagery). A deterministic gradient (tile-art.ts) forms the
// base, and a themed motif is layered on top so each promotion type reads
// as its own piece of art rather than a flat swatch. Purely decorative —
// never a source of truth for reward data.

import { tileGradient } from "@/lib/tile-art";
import type { PromotionType } from "@/lib/types";
import { cn } from "@/lib/utils";

const VB_W = 200;
const VB_H = 120;

function GiftMotif() {
  return (
    <g transform="translate(140 66) rotate(-8)" opacity="0.5">
      <rect x="-26" y="-6" width="52" height="40" rx="3" fill="rgba(255,255,255,0.16)" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
      <rect x="-26" y="-18" width="52" height="14" rx="3" fill="rgba(255,255,255,0.22)" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" />
      <rect x="-4" y="-18" width="8" height="52" fill="rgba(255,255,255,0.5)" />
      <path d="M-4 -18 C -20 -18 -18 -32 -4 -18 Z" fill="rgba(255,255,255,0.35)" stroke="rgba(255,255,255,0.5)" strokeWidth="1" />
      <path d="M4 -18 C 20 -18 18 -32 4 -18 Z" fill="rgba(255,255,255,0.35)" stroke="rgba(255,255,255,0.5)" strokeWidth="1" />
    </g>
  );
}

function TicketMotif() {
  const dots = Array.from({ length: 5 }, (_, i) => i);
  return (
    <g transform="translate(150 60) rotate(10)" opacity="0.5">
      <rect x="-46" y="-24" width="92" height="48" rx="6" fill="rgba(255,255,255,0.14)" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
      <line x1="12" y1="-24" x2="12" y2="24" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" strokeDasharray="3 4" />
      {dots.map((i) => (
        <circle key={i} cx="30" cy={-16 + i * 8} r="1.6" fill="rgba(255,255,255,0.45)" />
      ))}
    </g>
  );
}

function CalendarMotif() {
  return (
    <g transform="translate(146 62)" opacity="0.5">
      <rect x="-30" y="-22" width="60" height="48" rx="5" fill="rgba(255,255,255,0.14)" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
      <line x1="-30" y1="-8" x2="30" y2="-8" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
      <line x1="-14" y1="-28" x2="-14" y2="-16" stroke="rgba(255,255,255,0.45)" strokeWidth="2" strokeLinecap="round" />
      <line x1="14" y1="-28" x2="14" y2="-16" stroke="rgba(255,255,255,0.45)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="6" cy="10" r="9" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" />
      <path d="M6 5v5l3 3" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" />
    </g>
  );
}

function TrophyMotif() {
  return (
    <g transform="translate(148 64)" opacity="0.5">
      <path d="M-14 -20h28v10a14 14 0 0 1-28 0Z" fill="rgba(255,255,255,0.16)" stroke="rgba(255,255,255,0.42)" strokeWidth="1.5" />
      <path d="M14 -18h6a6 6 0 0 1-6 10M-14 -18h-6a6 6 0 0 0 6 10" fill="none" stroke="rgba(255,255,255,0.42)" strokeWidth="1.5" />
      <path d="M0 4v8M-10 20h20" stroke="rgba(255,255,255,0.42)" strokeWidth="1.5" strokeLinecap="round" />
    </g>
  );
}

function StarburstMotif() {
  const rays = Array.from({ length: 10 }, (_, i) => i);
  return (
    <g transform="translate(150 60)" opacity="0.45">
      {rays.map((i) => {
        const a = (i * 360) / rays.length;
        const rad = (a * Math.PI) / 180;
        const len = i % 2 === 0 ? 34 : 20;
        return (
          <line
            key={i}
            x1={0}
            y1={0}
            x2={Math.cos(rad) * len}
            y2={Math.sin(rad) * len}
            stroke="rgba(255,255,255,0.4)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        );
      })}
      <circle r="9" fill="rgba(255,255,255,0.22)" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" />
    </g>
  );
}

function CoinsMotif() {
  return (
    <g transform="translate(150 68)" opacity="0.5">
      {[0, 1, 2].map((i) => (
        <circle
          key={i}
          cx={-16 + i * 16}
          cy={-i * 5}
          r="17"
          fill="rgba(255,255,255,0.12)"
          stroke="rgba(255,255,255,0.4)"
          strokeWidth="1.5"
        />
      ))}
    </g>
  );
}

const MOTIF_BY_TYPE: Record<PromotionType, () => JSX.Element> = {
  DAILY: GiftMotif,
  SIGNUP: GiftMotif,
  MANUAL: GiftMotif,
  PROMO_CODE: GiftMotif,
  WEEKLY: TicketMotif,
  RAFFLE: TicketMotif,
  MONTHLY: CalendarMotif,
  LEADERBOARD: TrophyMotif,
  CHALLENGE: StarburstMotif,
  PROVIDER: StarburstMotif,
  SOCIAL: StarburstMotif,
  GAME_SPECIFIC: CoinsMotif,
  PURCHASE: CoinsMotif,
};

interface PromoArtProps {
  /** Deterministic seed for the gradient — usually the promotion id (or a
   * stable slug for placeholder cards). */
  seed: string;
  type: PromotionType;
  className?: string;
  /** Placeholder/"coming soon" cards render desaturated. */
  dimmed?: boolean;
}

export function PromoArt({ seed, type, className, dimmed }: PromoArtProps) {
  const Motif = MOTIF_BY_TYPE[type] ?? StarburstMotif;
  return (
    <div
      className={cn("absolute inset-0", dimmed && "saturate-[0.35] brightness-[0.55]", className)}
      style={{ background: tileGradient(seed) }}
    >
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        <Motif />
      </svg>
    </div>
  );
}
