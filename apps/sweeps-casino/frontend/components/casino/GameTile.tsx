"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { StarFilled, Star, Lock } from "@/components/ui/icons";
import { tileGradient, tilePatternId } from "@/lib/tile-art";
import { hasCustomArt, OriginalArt } from "@/components/casino/originals-art";
import { hasCategoryArt, CategoryArt } from "@/components/casino/category-art";
import { api } from "@/lib/api-client";
import { isPlayableGame } from "@/lib/playable-games";
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
  // Slots with a real, built game engine (today: just vault-breaker, see
  // lib/playable-games.ts) route to the dedicated fullscreen slot page
  // rather than the generic /casino/games/[slug] detail stub.
  const isPlayableSlotGame = game.category === "SLOTS" && game.slug === "vault-breaker";
  const playable = isPlayableGame(game);
  const link = href ?? (isOriginal ? `/casino/originals/${game.slug}` : isPlayableSlotGame ? `/casino/slots/${game.slug}` : `/casino/games/${game.slug}`);

  // EXCLUSIVE/JACKPOT aren't surfaced as dedicated booleans by the backend's
  // toDto() mapper (only isNew/isHot are) — read them off the raw tags
  // array instead. Priority order: JACKPOT > EXCLUSIVE > HOT > NEW. Cards
  // show at most one badge; a second is only added when the top badge is
  // itself a "special" one (Jackpot/Exclusive) — that's the one deliberate
  // reason to stack (e.g. a Jackpot game that's also brand new), so a
  // merely Hot + New game never shows two badges by default clutter.
  const isExclusive = !!game.tags?.includes("EXCLUSIVE");
  const isJackpot = !!game.tags?.includes("JACKPOT");
  const allBadges: { key: string; variant: BadgeVariant; label: string }[] = [];
  if (isJackpot) allBadges.push({ key: "jackpot", variant: "jackpot", label: "Jackpot" });
  if (isExclusive) allBadges.push({ key: "exclusive", variant: "exclusive", label: "Exclusive" });
  if (game.isHot) allBadges.push({ key: "hot", variant: "hot", label: "Hot" });
  if (game.isNew) allBadges.push({ key: "new", variant: "new", label: "New" });
  const topIsSpecial = allBadges[0]?.key === "jackpot" || allBadges[0]?.key === "exclusive";
  const badges = allBadges.slice(0, topIsSpecial ? 2 : 1);

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

  // Per explicit product direction: a SLOTS card with no real engine behind
  // it yet never navigates anywhere on tap — it shows a "Coming Soon"
  // overlay right on the card instead of opening a dead detail page. Every
  // other category is unaffected (isPlayableGame() only gates SLOTS).
  const wrapperClassName =
    "group block w-[37vw] max-w-[140px] shrink-0 snap-start animate-fade-in-up sm:w-[180px] sm:max-w-none" +
    (playable ? "" : " cursor-default");
  const wrapperStyle =
    index != null ? { animationDelay: `${Math.min(index, 8) * 30}ms`, animationFillMode: "backwards" as const } : undefined;

  const cardBody = (
    <>
      <div
        className={cn(
          "relative aspect-[3/4] w-full overflow-hidden rounded-xl border transition-all duration-200 ease-premium group-hover:-translate-y-1 group-hover:scale-[1.03] group-active:scale-95",
          // Originals read as a "poster", not a generic catalog tile: a
          // faint permanent teal edge even at rest, blooming into the full
          // glow on hover. The wider catalog gets a neutral border and the
          // ambient "lift" shadow so it reads as physically raised rather
          // than tinted a color.
          isOriginal
            ? "border-accent-sc/25 group-hover:border-accent-sc/60 group-hover:shadow-glow-sc"
            : "border-border group-hover:shadow-card-lift"
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
          {!playable && (
            <Badge variant="neutral" className="gap-1">
              <Lock className="h-2.5 w-2.5" />
              Coming Soon
            </Badge>
          )}
          {playable && badges.map((b) => (
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
          {/* Originals show the house label, never the RTP/provider text a
              generic catalog card would — spec item 6: "name + Vaultline
              Original + optional badge", nothing else. */}
          <p
            className={cn(
              "truncate text-[10px] uppercase tracking-wide",
              isOriginal ? "font-semibold text-accent-sc/85" : "text-white/55"
            )}
          >
            {isOriginal ? "Vaultline Original" : game.provider}
          </p>
        </div>

        {playable ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            <Button size="sm" variant="sc">
              Play
            </Button>
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-black/55">
            <Lock className="h-6 w-6 text-white/70" />
          </div>
        )}
      </div>
    </>
  );

  return playable ? (
    <Link href={link} className={wrapperClassName} style={wrapperStyle}>
      {cardBody}
    </Link>
  ) : (
    <div
      className={wrapperClassName}
      style={wrapperStyle}
      role="group"
      aria-label={`${game.name} — coming soon, not yet playable`}
    >
      {cardBody}
    </div>
  );
}
