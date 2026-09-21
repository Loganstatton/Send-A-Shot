"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { ChevronLeft, ChevronRight } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

interface Cta {
  label: string;
  href: string;
  variant?: "primary" | "outline";
}

interface Slide {
  id: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  ctas: Cta[];
  /** Two-tone accent used by the shared HeroArt background (rgb triples). */
  accentA: string;
  accentB: string;
}

// CMS-free Phase 1 banner content (docs §5 lobby banner — "can be a simple
// static carousel for Phase 1"). Swappable for `/admin/cms` output in P2.
// Casino Visual Redesign sprint: 5 rotating slides, cinematic art-only
// (no photography/third-party imagery — see HeroArt below, mirroring the
// inline-SVG-and-gradient approach established in originals-art.tsx).
const SLIDES: Slide[] = [
  {
    id: "welcome",
    eyebrow: "Vaultline",
    title: "Welcome to Vaultline",
    subtitle: "Play. Earn. Level Up.",
    ctas: [
      { label: "Play Now", href: "/casino/originals/dice", variant: "primary" },
      { label: "Claim Daily Reward", href: "/rewards/daily-bonus", variant: "outline" },
    ],
    accentA: "234 176 62",
    accentB: "32 201 184",
  },
  {
    id: "daily",
    eyebrow: "Every day",
    title: "Claim Your Daily Rewards",
    subtitle: "Log in every day to build your streak and earn more Gold Coins.",
    ctas: [{ label: "Claim Now", href: "/rewards/daily-bonus", variant: "primary" }],
    accentA: "234 176 62",
    accentB: "234 176 62",
  },
  {
    id: "originals",
    eyebrow: "House-built",
    title: "Vaultline Originals",
    subtitle: "Provably-fair Dice, Mines & Plinko — built in-house, yours to play.",
    ctas: [{ label: "Play Originals", href: "/casino/originals/dice", variant: "primary" }],
    accentA: "107 91 214",
    accentB: "32 201 184",
  },
  {
    id: "vip",
    eyebrow: "Climb the ranks",
    title: "Climb the VIP Club",
    subtitle: "Unlock better rewards and perks the more you play.",
    ctas: [{ label: "View VIP Club", href: "/rewards/vip-club", variant: "primary" }],
    accentA: "32 201 184",
    accentB: "107 91 214",
  },
  {
    id: "new",
    eyebrow: "Fresh arrivals",
    title: "New Games, Every Week",
    subtitle: "The vault keeps growing — check out the newest arrivals in the lobby.",
    ctas: [{ label: "See New Games", href: "/casino/search?sort=new", variant: "primary" }],
    accentA: "32 201 184",
    accentB: "234 176 62",
  },
];

const ROTATE_MS = 6000;
const SWIPE_THRESHOLD = 40;

/**
 * Pure CSS/SVG cinematic backdrop shared by all slides — a soft vault-door
 * arc motif, a faint roulette-spoke radial, two rim-lit coin glows and a
 * diagonal light-beam sweep, recolored per slide via `accentA`/`accentB`.
 * No external images, no stock photography, nothing resembling a real
 * casino's branding.
 */
function HeroArt({ accentA, accentB }: { accentA: string; accentB: string }) {
  const style = { "--hero-a": accentA, "--hero-b": accentB } as React.CSSProperties;
  return (
    <div className="absolute inset-0" style={style} aria-hidden>
      {/* Base wash */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(135deg, rgb(10 11 14) 0%, rgb(var(--hero-a) / 0.16) 45%, rgb(10 11 14) 100%)`,
        }}
      />
      {/* Very slow drifting secondary wash for a barely-perceptible living quality */}
      <div
        className="absolute inset-0 animate-ambient-drift opacity-70"
        style={{
          backgroundImage: `radial-gradient(45% 65% at 82% 20%, rgb(var(--hero-b) / 0.22), transparent 70%)`,
          backgroundSize: "130% 130%",
        }}
      />
      {/* Vault-door concentric arcs, echoing the "Vaultline" name */}
      <svg
        className="absolute -right-10 -top-16 h-[220%] w-[70%] opacity-[0.16] sm:-right-4 sm:-top-24"
        viewBox="0 0 200 200"
        preserveAspectRatio="xMidYMid slice"
      >
        {[92, 76, 60, 44, 28].map((r) => (
          <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="white" strokeWidth={1.5} strokeDasharray="6 5" />
        ))}
      </svg>
      {/* Faint roulette-spoke radial pattern */}
      <svg className="absolute -left-8 bottom-[-30%] h-[140%] w-[55%] opacity-[0.10]" viewBox="0 0 200 200">
        <g transform="translate(100 100)">
          {Array.from({ length: 12 }).map((_, i) => {
            const angle = (i * 360) / 12;
            const rad = (angle * Math.PI) / 180;
            return (
              <line
                key={i}
                x1={0}
                y1={0}
                x2={Math.cos(rad) * 95}
                y2={Math.sin(rad) * 95}
                stroke="white"
                strokeWidth={1}
              />
            );
          })}
          <circle r={95} fill="none" stroke="white" strokeWidth={1.5} />
        </g>
      </svg>
      {/* Rim-lit coin/chip glows */}
      <div
        className="absolute right-[8%] top-[12%] h-24 w-24 rounded-full sm:h-32 sm:w-32"
        style={{
          background: `radial-gradient(circle at 35% 30%, rgb(var(--hero-a) / 0.55), rgb(var(--hero-a) / 0.05) 70%)`,
          boxShadow: `0 0 60px 6px rgb(var(--hero-a) / 0.18)`,
        }}
      />
      <div
        className="absolute bottom-[6%] right-[26%] h-14 w-14 rounded-full sm:h-20 sm:w-20"
        style={{
          background: `radial-gradient(circle at 35% 30%, rgb(var(--hero-b) / 0.5), rgb(var(--hero-b) / 0.04) 70%)`,
        }}
      />
      {/* Diagonal light-beam sweep */}
      <div
        className="absolute inset-0 opacity-[0.08]"
        style={{
          background: "linear-gradient(115deg, transparent 30%, white 48%, transparent 66%)",
        }}
      />
    </div>
  );
}

export function PromoBanner() {
  const [index, setIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const touchDeltaX = useRef(0);

  useEffect(() => {
    const t = setInterval(() => setIndex((i) => (i + 1) % SLIDES.length), ROTATE_MS);
    return () => clearInterval(t);
  }, []);

  function go(delta: number) {
    setIndex((i) => (i + delta + SLIDES.length) % SLIDES.length);
  }

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
    touchDeltaX.current = 0;
  }
  function onTouchMove(e: React.TouchEvent) {
    if (touchStartX.current == null) return;
    touchDeltaX.current = e.touches[0].clientX - touchStartX.current;
  }
  function onTouchEnd() {
    if (Math.abs(touchDeltaX.current) > SWIPE_THRESHOLD) {
      go(touchDeltaX.current < 0 ? 1 : -1);
    }
    touchStartX.current = null;
    touchDeltaX.current = 0;
  }

  const slide = SLIDES[index];

  return (
    <div
      className="bg-casino-vignette relative h-[280px] w-full touch-pan-y overflow-hidden rounded-2xl border border-border/60 shadow-card-lift sm:h-[340px]"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <HeroArt accentA={slide.accentA} accentB={slide.accentB} />

      <div className="relative z-10 flex h-full flex-col justify-center gap-3 p-6 sm:gap-4 sm:p-10">
        <span className="text-xs font-bold uppercase tracking-[0.2em] text-accent-sc">{slide.eyebrow}</span>
        <h1 className="max-w-md text-3xl font-extrabold leading-tight tracking-tight text-white drop-shadow-lg sm:text-4xl lg:text-5xl">
          {slide.title}
        </h1>
        <p className="max-w-sm text-sm text-white/80 sm:text-base">{slide.subtitle}</p>
        <div className="mt-1 flex flex-wrap gap-2.5 sm:mt-2">
          {slide.ctas.map((cta) => (
            <Link key={cta.href} href={cta.href}>
              <Button variant={cta.variant === "outline" ? "secondary" : "primary"} size="md">
                {cta.label}
              </Button>
            </Link>
          ))}
        </div>
      </div>

      <div className="absolute bottom-3 right-3 z-10 flex items-center gap-2 rounded-full bg-black/25 px-2 py-1.5 backdrop-blur-sm sm:bottom-4 sm:right-4">
        <button
          onClick={() => go(-1)}
          className="flex h-7 w-7 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white"
          aria-label="Previous slide"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex gap-1.5">
          {SLIDES.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setIndex(i)}
              aria-label={`Go to slide ${i + 1}`}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === index ? "w-5 bg-accent-gc" : "w-1.5 bg-white/40"
              )}
            />
          ))}
        </div>
        <button
          onClick={() => go(1)}
          className="flex h-7 w-7 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white"
          aria-label="Next slide"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
