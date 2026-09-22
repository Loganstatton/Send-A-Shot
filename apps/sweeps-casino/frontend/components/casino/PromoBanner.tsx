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

type Focal = "vault" | "chips" | "dice" | "wheel" | "sparkle";

interface Slide {
  id: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  ctas: Cta[];
  /** Two-tone accent used by the shared HeroArt background (rgb triples). */
  accentA: string;
  accentB: string;
  /** The slide's dominant compositional subject (spec items 22-23: each
   * slide needs a clear focal subject, not an interchangeable backdrop). */
  focal: Focal;
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
    focal: "vault",
  },
  {
    id: "daily",
    eyebrow: "Every day",
    title: "Claim Your Daily Rewards",
    subtitle: "Log in every day to build your streak and earn more Gold Coins.",
    ctas: [{ label: "Claim Now", href: "/rewards/daily-bonus", variant: "primary" }],
    accentA: "234 176 62",
    accentB: "234 176 62",
    focal: "chips",
  },
  {
    id: "originals",
    eyebrow: "House-built",
    title: "Vaultline Originals",
    subtitle: "Provably-fair Dice, Mines & Plinko — built in-house, yours to play.",
    ctas: [{ label: "Play Originals", href: "/casino/originals/dice", variant: "primary" }],
    accentA: "107 91 214",
    accentB: "32 201 184",
    focal: "dice",
  },
  {
    id: "vip",
    eyebrow: "Climb the ranks",
    title: "Climb the VIP Club",
    subtitle: "Unlock better rewards and perks the more you play.",
    ctas: [{ label: "View VIP Club", href: "/rewards/vip-club", variant: "primary" }],
    accentA: "32 201 184",
    accentB: "107 91 214",
    focal: "wheel",
  },
  {
    id: "new",
    eyebrow: "Fresh arrivals",
    title: "New Games, Every Week",
    subtitle: "The vault keeps growing — check out the newest arrivals in the lobby.",
    ctas: [{ label: "See New Games", href: "/casino/search?sort=new", variant: "primary" }],
    accentA: "32 201 184",
    accentB: "234 176 62",
    focal: "sparkle",
  },
];

const ROTATE_MS = 6000;
const SWIPE_THRESHOLD = 40;

/**
 * Each slide's dominant compositional subject (spec items 22-23) — a
 * large, unmistakable shape parked on the right side of the banner so the
 * headline on the left reads as the clear point of focus, not competing
 * with generic decoration. Pure inline SVG/gradients, no external images.
 */
function FocalArt({ focal }: { focal: Focal }) {
  if (focal === "vault") {
    return (
      <svg className="absolute -right-6 top-1/2 h-[85%] w-[55%] -translate-y-1/2 opacity-90 sm:w-[38%]" viewBox="0 0 200 200" aria-hidden>
        <circle cx="100" cy="100" r="78" fill="none" stroke="rgb(var(--hero-a))" strokeWidth={3} opacity="0.35" />
        <circle cx="100" cy="100" r="60" fill="none" stroke="white" strokeWidth={1.5} opacity="0.25" strokeDasharray="4 6" />
        {Array.from({ length: 10 }).map((_, i) => {
          const a = (i * 360) / 10;
          const rad = (a * Math.PI) / 180;
          const x = 100 + Math.cos(rad) * 78;
          const y = 100 + Math.sin(rad) * 78;
          return <circle key={i} cx={x} cy={y} r={3.5} fill="white" opacity="0.3" />;
        })}
        <g stroke="rgb(var(--hero-b))" strokeWidth={2.5} opacity="0.5" strokeLinecap="round">
          <line x1="100" y1="52" x2="100" y2="72" />
          <line x1="100" y1="128" x2="100" y2="148" />
          <line x1="52" y1="100" x2="72" y2="100" />
          <line x1="128" y1="100" x2="148" y2="100" />
        </g>
        <circle cx="100" cy="100" r="16" fill="rgb(var(--hero-a) / 0.4)" stroke="white" strokeWidth={1.5} opacity="0.6" />
        <rect x="94" y="82" width="12" height="36" rx="3" fill="white" opacity="0.35" />
      </svg>
    );
  }
  if (focal === "chips") {
    const offsets = [0, -18, -34, -48, -60];
    return (
      <svg className="absolute -right-2 bottom-[-10%] h-[95%] w-[45%] opacity-90 sm:w-[30%]" viewBox="0 0 160 220" aria-hidden>
        {offsets.map((dy, i) => (
          <g key={i} transform={`translate(80 ${190 + dy})`}>
            <ellipse rx="46" ry="16" fill={i % 2 === 0 ? "rgb(var(--hero-a) / 0.55)" : "rgb(var(--hero-b) / 0.5)"} stroke="white" strokeOpacity="0.25" strokeWidth={1.5} />
            <ellipse rx="46" ry="16" fill="none" stroke="white" strokeOpacity="0.4" strokeWidth={1} strokeDasharray="3 5" />
          </g>
        ))}
      </svg>
    );
  }
  if (focal === "dice") {
    return (
      <svg className="absolute -right-4 top-1/2 h-[75%] w-[60%] -translate-y-1/2 opacity-90 sm:w-[42%]" viewBox="0 0 200 200" aria-hidden>
        <g transform="rotate(-16 78 110)">
          <rect x="30" y="62" width="96" height="96" rx="14" fill="rgb(var(--hero-a) / 0.28)" stroke="white" strokeOpacity="0.4" strokeWidth={2} />
          {[[52, 84], [104, 84], [52, 136], [104, 136], [78, 110]].map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r={8} fill="white" opacity="0.75" />
          ))}
        </g>
        <g transform="rotate(18 148 150)" opacity="0.85">
          <rect x="118" y="118" width="64" height="64" rx="10" fill="rgb(var(--hero-b) / 0.32)" stroke="white" strokeOpacity="0.4" strokeWidth={1.5} />
          {[[136, 136], [164, 150], [136, 164]].map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r={5.5} fill="white" opacity="0.7" />
          ))}
        </g>
        {[0, 1, 2].map((i) => (
          <line key={i} x1={10} y1={70 + i * 10} x2={40} y2={70 + i * 10} stroke="rgb(var(--hero-b))" strokeWidth={2 - i * 0.4} opacity="0.4" strokeLinecap="round" />
        ))}
      </svg>
    );
  }
  if (focal === "wheel") {
    const segs = 14;
    return (
      <svg className="absolute -right-6 top-1/2 h-[90%] w-[58%] -translate-y-1/2 opacity-90 sm:w-[40%]" viewBox="0 0 200 200" aria-hidden>
        <g transform="translate(100 100)">
          {Array.from({ length: segs }).map((_, i) => {
            const a1 = (i * 360) / segs;
            const a2 = ((i + 1) * 360) / segs;
            const r1 = (a1 * Math.PI) / 180;
            const r2 = (a2 * Math.PI) / 180;
            return (
              <path
                key={i}
                d={`M0 0 L${Math.cos(r1) * 88} ${Math.sin(r1) * 88} A88 88 0 0 1 ${Math.cos(r2) * 88} ${Math.sin(r2) * 88} Z`}
                fill={i % 2 === 0 ? "rgb(var(--hero-a) / 0.3)" : "rgb(var(--hero-b) / 0.22)"}
                stroke="white"
                strokeOpacity="0.15"
                strokeWidth={0.75}
              />
            );
          })}
          <circle r="88" fill="none" stroke="white" strokeOpacity="0.3" strokeWidth={2} />
          <circle r="18" fill="rgb(10 11 14 / 0.6)" stroke="white" strokeOpacity="0.4" strokeWidth={1.5} />
          <circle cx="60" cy="-20" r="4" fill="white" opacity="0.8" />
        </g>
      </svg>
    );
  }
  // sparkle
  return (
    <svg className="absolute -right-2 top-1/2 h-[80%] w-[55%] -translate-y-1/2 opacity-90 sm:w-[38%]" viewBox="0 0 200 200" aria-hidden>
      <g transform="translate(120 90)">
        {Array.from({ length: 10 }).map((_, i) => {
          const a = (i * 360) / 10;
          const rad = (a * Math.PI) / 180;
          return (
            <line
              key={i}
              x1={Math.cos(rad) * 20}
              y1={Math.sin(rad) * 20}
              x2={Math.cos(rad) * 70}
              y2={Math.sin(rad) * 70}
              stroke="rgb(var(--hero-a))"
              strokeWidth={3}
              opacity="0.4"
              strokeLinecap="round"
            />
          );
        })}
        <circle r="14" fill="white" opacity="0.55" />
      </g>
      {[[46, 150, 5], [150, 40, 4], [170, 130, 3.5], [30, 60, 3]].map(([cx, cy, r], i) => (
        <circle key={i} cx={cx} cy={cy} r={r} fill="rgb(var(--hero-b))" opacity="0.55" />
      ))}
    </svg>
  );
}

/**
 * Pure CSS/SVG cinematic backdrop shared by all slides — a soft vault-door
 * arc motif, a faint roulette-spoke radial, the slide's FocalArt subject
 * and a diagonal light-beam sweep, recolored per slide via
 * `accentA`/`accentB`. No external images, no stock photography, nothing
 * resembling a real casino's branding.
 */
function HeroArt({ accentA, accentB, focal }: { accentA: string; accentB: string; focal: Focal }) {
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
      {/* Rim-light glow seating the focal subject */}
      <div
        className="absolute right-[4%] top-1/2 h-40 w-40 -translate-y-1/2 rounded-full sm:h-56 sm:w-56"
        style={{
          background: `radial-gradient(circle at 40% 35%, rgb(var(--hero-a) / 0.35), transparent 70%)`,
          boxShadow: `0 0 80px 10px rgb(var(--hero-a) / 0.12)`,
        }}
      />
      <FocalArt focal={focal} />
      {/* Diagonal light-beam sweep — depth cue that rakes across the
          headline toward the focal subject on the right. */}
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
      <HeroArt accentA={slide.accentA} accentB={slide.accentB} focal={slide.focal} />

      <div className="relative z-10 flex h-full max-w-[70%] flex-col justify-center gap-3 p-6 sm:max-w-none sm:gap-4 sm:p-10">
        <span className="text-xs font-bold uppercase tracking-[0.2em] text-accent-sc">{slide.eyebrow}</span>
        <h1 className="max-w-md text-3xl font-extrabold leading-tight tracking-tight text-white drop-shadow-lg sm:text-4xl lg:text-5xl">
          {slide.title}
        </h1>
        <p className="max-w-sm text-sm text-white/80 sm:text-base">{slide.subtitle}</p>
        {/* One clear primary CTA; any further CTA is a smaller, lower-
            weight text link — never a second equal-weight button — so
            mobile always has a single unambiguous next action. */}
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2 sm:mt-2">
          {slide.ctas.map((cta, i) =>
            i === 0 ? (
              <Link key={cta.href} href={cta.href}>
                <Button variant="primary" size="md">
                  {cta.label}
                </Button>
              </Link>
            ) : (
              <Link
                key={cta.href}
                href={cta.href}
                className="text-xs font-semibold text-white/75 underline decoration-white/30 underline-offset-4 transition-colors hover:text-white"
              >
                {cta.label}
              </Link>
            )
          )}
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
