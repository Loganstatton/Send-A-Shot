"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { StarFilled, Star } from "@/components/ui/icons";
import { tileGradient, tilePatternId } from "@/lib/tile-art";
import { hasCustomArt, OriginalArt } from "@/components/casino/originals-art";
import { hasCategoryArt, CategoryArt } from "@/components/casino/category-art";
import { api } from "@/lib/api-client";
import type { Game } from "@/lib/types";
import { cn } from "@/lib/utils";

const PATTERNS = [
  "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.25) 0, transparent 40%)",
  "repeating-linear-gradient(45deg, rgba(255,255,255,0.12) 0 8px, transparent 8px 16px)",
  "radial-gradient(circle at 70% 70%, rgba(0,0,0,0.25) 0, transparent 45%)",
  "repeating-radial-gradient(circle at 50% 50%, rgba(255,255,255,0.15) 0 2px, transparent 2px 14px)",
];

export function GameTile({ game, href, index }: { game: Game; href?: string; index?: number }) {
  const [favorite, setFavorite] = useState(!!game.isFavorite);
  const [busy, setBusy] = useState(false);
  const seed = game.thumbSeed || game.slug;
  const isOriginal = hasCustomArt(game.slug);
  const usesCategoryArt = !isOriginal && hasCategoryArt(game.category);
  const link = href ?? (isOriginal ? `/casino/originals/${game.slug}` : `/casino/games/${game.slug}`);

  // EXCLUSIVE/JACKPOT aren't surfaced as dedicated booleans by the backend's
  // toDto() mapper (only isNew/isHot are) — read them off the raw tags
  // array instead. Priority order when a card qualifies for more than two:
  // JACKPOT > EXCLUSIVE > HOT > NEW, capped at 2 so a stack of badges never
  // crowds a ~140px-wide card.
  const isExclusive = !!game.tags?.includes("EXCLUSIVE");
  const isJackpot = !!game.tags?.includes("JACKPOT");
  const allBadges: { key: string; variant: BadgeVariant; label: string }[] = [];
  if (isJackpot) allBadges.push({ key: "jackpot", variant: "jackpot", label: "Jackpot" });
  if (isExclusive) allBadges.push({ key: "exclusive", variant: "exclusive", label: "Exclusive" });
  if (game.isHot) allBadges.push({ key: "hot", variant: "hot", label: "Hot" });
  if (game.isNew) allBadges.push({ key: "new", variant: "new", label: "New" });
  const badges = allBadges.slice(0, 2);

  async function toggleFavorite(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    const next = !favorite;
    setFavorite(next);
    try {
      if (next) {
        await api.post(`/casino/favorites/${game.id}`);
      } else {
        await api.delete(`/casino/favorites/${game.id}`);
      }
    } catch {
      setFavorite(!next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Link
      href={link}
      className="group block w-[37vw] max-w-[140px] shrink-0 snap-start animate-fade-in-up sm:w-[180px] sm:max-w-none"
      style={index != null ? { animationDelay: `${Math.min(index, 8) * 30}ms`, animationFillMode: "backwards" } : undefined}
    >
      <div
        className={cn(
          "relative aspect-[3/4] w-full overflow-hidden rounded-lg border border-border transition-all duration-200 ease-premium group-hover:-translate-y-1 group-hover:scale-[1.03] group-active:scale-95",
          // Originals keep their signature teal glow on hover; the wider
          // catalog gets the neutral ambient "lift" shadow so the card
          // reads as physically raised rather than tinted a color.
          isOriginal ? "group-hover:shadow-glow-sc" : "group-hover:shadow-card-lift"
        )}
        style={isOriginal || usesCategoryArt ? undefined : { background: tileGradient(seed) }}
      >
        {hasCustomArt(game.slug) ? (
          <div className="absolute inset-0 animate-fade-in">
            <OriginalArt slug={game.slug} />
          </div>
        ) : usesCategoryArt ? (
          <div className="absolute inset-0 animate-fade-in">
            <CategoryArt category={game.category as "SLOTS" | "TABLE_GAMES" | "LIVE_CASINO" | "GAME_SHOWS"} seed={seed} />
          </div>
        ) : (
          <div className="absolute inset-0 animate-fade-in" style={{ background: PATTERNS[tilePatternId(seed)] }} />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />

        <div className="absolute left-2 top-2 flex max-w-[calc(100%-2.25rem)] flex-wrap gap-1">
          {badges.map((b) => (
            <Badge key={b.key} variant={b.variant}>
              {b.label}
            </Badge>
          ))}
        </div>

        <button
          onClick={toggleFavorite}
          aria-label="Toggle favorite"
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition-transform duration-150 ease-snappy hover:scale-110 active:scale-90"
        >
          <span key={favorite ? "on" : "off"} className="inline-flex animate-pop">
            {favorite ? <StarFilled className="h-3.5 w-3.5 text-accent-gc" /> : <Star className="h-3.5 w-3.5" />}
          </span>
        </button>

        <div className="absolute inset-x-0 bottom-0 p-2.5">
          <p className="truncate text-sm font-bold leading-tight text-white drop-shadow">{game.name}</p>
          <p className="truncate text-[10px] uppercase tracking-wide text-white/55">{game.provider}</p>
          {typeof game.rtp === "number" && (
            <p className="text-[9px] text-white/40">RTP {game.rtp.toFixed(2)}%</p>
          )}
        </div>

        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <Button size="sm" variant="sc">
            Play
          </Button>
        </div>
      </div>
    </Link>
  );
}
