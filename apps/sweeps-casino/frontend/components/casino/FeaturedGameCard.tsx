import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { ArrowRight, Shield } from "@/components/ui/icons";
import { hasCustomArt, OriginalArt } from "@/components/casino/originals-art";
import { hasCategoryArt, CategoryArt } from "@/components/casino/category-art";
import { tileGradient } from "@/lib/tile-art";
import type { Game } from "@/lib/types";

/**
 * Large landscape "hero" card for a single featured game — spec item 5.
 * Sits between rails on Home, spanning most of the content width. Reuses
 * the same procedural art components as GameTile (OriginalArt /
 * CategoryArt), just cropped wider via `preserveAspectRatio="xMidYMid
 * slice"` on a landscape box instead of GameTile's portrait one — no new
 * art system, no external image assets.
 */
export function FeaturedGameCard({ game, tagline }: { game: Game; tagline?: string }) {
  const seed = game.thumbSeed || game.slug;
  const isOriginal = hasCustomArt(game.slug);
  const usesCategoryArt = !isOriginal && hasCategoryArt(game.category);
  const href = isOriginal ? `/casino/originals/${game.slug}` : `/casino/games/${game.slug}`;
  const label = tagline ?? (isOriginal ? "Exclusive Vaultline Original" : "Featured Game");

  return (
    <Link
      href={href}
      className="group relative block h-[220px] w-full overflow-hidden rounded-2xl border border-border/60 shadow-card-lift transition-transform duration-300 ease-premium hover:-translate-y-0.5 sm:h-[280px]"
      style={isOriginal || usesCategoryArt ? undefined : { background: tileGradient(seed) }}
    >
      <div className="absolute inset-0 transition-transform duration-500 ease-premium group-hover:scale-[1.06]">
        {hasCustomArt(game.slug) ? (
          <OriginalArt slug={game.slug} />
        ) : usesCategoryArt ? (
          <CategoryArt category={game.category as "SLOTS" | "TABLE_GAMES" | "LIVE_CASINO" | "GAME_SHOWS"} seed={seed} />
        ) : null}
      </div>

      {/* Darken left->right so the copy stays legible while the art
          breathes toward the right edge of the card. */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/55 to-black/10" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

      <div className="relative z-10 flex h-full max-w-md flex-col justify-center gap-2.5 p-6 sm:gap-3 sm:p-10">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-accent-sc/40 bg-accent-sc/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-accent-sc backdrop-blur-sm">
          <Shield className="h-3 w-3" />
          {label}
        </span>
        <h3 className="text-2xl font-extrabold leading-tight text-white drop-shadow-lg sm:text-3xl">{game.name}</h3>
        <p className="text-xs text-white/60 sm:text-sm">{game.provider}</p>
        <div className="mt-1">
          <Button size="md" variant="sc" className="gap-1.5">
            Play Now
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Button>
        </div>
      </div>
    </Link>
  );
}
