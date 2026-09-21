"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { ChevronLeft, ChevronRight } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

interface Slide {
  id: string;
  title: string;
  subtitle: string;
  cta: string;
  href: string;
  gradient: string;
}

// CMS-free Phase 1 banner content (docs §5 lobby banner — "can be a simple
// static carousel for Phase 1"). Swappable for `/admin/cms` output in P2.
const SLIDES: Slide[] = [
  {
    id: "welcome",
    title: "Welcome to Vaultline",
    subtitle: "Play free Gold Coin games every day — no purchase necessary.",
    cta: "Explore Originals",
    href: "/casino/originals/dice",
    gradient: "linear-gradient(120deg, #1c2430 0%, #2dbfb0 140%)",
  },
  {
    id: "daily",
    title: "Claim your Daily Bonus",
    subtitle: "Log in every day to build your streak and earn more Gold Coins.",
    cta: "Claim now",
    href: "/rewards/daily-bonus",
    gradient: "linear-gradient(120deg, #1c2430 0%, #e8a842 140%)",
  },
  {
    id: "vip",
    title: "Climb the VIP Club",
    subtitle: "Unlock better rewards and perks the more you play.",
    cta: "View VIP Club",
    href: "/rewards/vip-club",
    gradient: "linear-gradient(120deg, #1c2430 0%, #6b5bd6 140%)",
  },
];

export function PromoBanner() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setIndex((i) => (i + 1) % SLIDES.length), 6000);
    return () => clearInterval(t);
  }, []);

  const slide = SLIDES[index];

  return (
    <div className="relative overflow-hidden rounded-xl border border-border" style={{ background: slide.gradient }}>
      <div className="relative z-10 flex flex-col gap-3 p-6 sm:p-8">
        <h1 className="max-w-md text-2xl font-extrabold text-white drop-shadow sm:text-3xl">{slide.title}</h1>
        <p className="max-w-sm text-sm text-white/85">{slide.subtitle}</p>
        <div>
          <Link href={slide.href}>
            <Button variant="primary" size="md">
              {slide.cta}
            </Button>
          </Link>
        </div>
      </div>

      <div className="absolute bottom-3 right-4 z-10 flex items-center gap-2">
        <button
          onClick={() => setIndex((i) => (i - 1 + SLIDES.length) % SLIDES.length)}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-black/30 text-white hover:bg-black/50"
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
              className={cn("h-1.5 rounded-full transition-all", i === index ? "w-5 bg-white" : "w-1.5 bg-white/40")}
            />
          ))}
        </div>
        <button
          onClick={() => setIndex((i) => (i + 1) % SLIDES.length)}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-black/30 text-white hover:bg-black/50"
          aria-label="Next slide"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
