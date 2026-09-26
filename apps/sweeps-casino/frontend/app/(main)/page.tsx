"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { PromoBanner } from "@/components/casino/PromoBanner";
import { CategoryBar } from "@/components/casino/CategoryBar";
import { LiveWins } from "@/components/casino/LiveWins";
import { JackpotDisplay } from "@/components/casino/JackpotDisplay";
import { ProviderRail } from "@/components/casino/ProviderRail";
import { DailyRewardCard } from "@/components/casino/DailyRewardCard";
import { VipProgressCard } from "@/components/casino/VipProgressCard";
import { FeaturedGameCard } from "@/components/casino/FeaturedGameCard";
import { PromoCard } from "@/components/casino/PromoCard";
import { GameRow } from "@/components/casino/GameRow";
import { useFetch } from "@/lib/hooks/useFetch";
import { api } from "@/lib/api-client";
import { isFeaturableInHomeRails } from "@/lib/playable-games";
import type { Game, LobbySection, Promotion } from "@/lib/types";

/**
 * Casino Visual Redesign sprint — Home page composition (sprint spec items
 * 2-17; item 1 "compact top navigation" lives in the layout/Topbar, owned
 * by a different agent, not here).
 *
 * Home is the curated, storytelling entry point — hero, a handful of
 * hand-ordered rails, one big Featured Game moment, a Live Wins ticker, the
 * Jackpot banner, reward teasers and a Promotions taste. The full,
 * dense, filterable library lives on the new `/casino` page instead (see
 * app/(main)/casino/page.tsx) — Home never tries to be that.
 *
 * The backend (`GET /casino/sections`, see CatalogService.getSections)
 * returns exactly these 11 sections with stable `key`s: recently-played,
 * popular, originals, trending, new-releases, slots, table-games,
 * live-casino, game-shows, jackpots, favorites. This page only uses the
 * subset the curated hierarchy below calls for — slots/table-games/
 * live-casino/game-shows/jackpots (as a games list) are deliberately left
 * to the Casino page and CategoryBar links rather than duplicated here.
 *
 * Deviation from the spec's literal section list, called out explicitly:
 * the spec lists both a top "Continue Playing" slot and a bottom
 * "Recently Played / Favorites" slot. The backend only has ONE
 * recently-played section, so showing it twice would just duplicate the
 * same rail on one page — "Continue Playing" (top) uses it once, and the
 * bottom slot is Favorites only.
 */
interface RailSlot {
  key: string;
  title: string;
  seeAllHref?: string;
}

const CONTINUE_PLAYING: RailSlot = { key: "recently-played", title: "Continue Playing", seeAllHref: "/casino/recently-played" };

const HEAD_RAILS: RailSlot[] = [
  { key: "originals", title: "Vaultline Originals", seeAllHref: "/casino/originals/dice" },
  { key: "popular", title: "Popular Now", seeAllHref: "/casino" },
];

const MID_RAILS: RailSlot[] = [
  { key: "trending", title: "Trending", seeAllHref: "/casino?filter=all" },
];

const NEW_RAIL: RailSlot = { key: "new-releases", title: "New Games", seeAllHref: "/casino/search?sort=new" };

const TAIL_RAILS: RailSlot[] = [{ key: "favorites", title: "Favorites", seeAllHref: "/casino/favorites" }];

/** Best real game to headline the Featured Game card — an EXCLUSIVE-tagged
 * title if one exists in the sections we already fetched, otherwise the
 * top-ranked Popular/Originals/Trending pick. Never fabricated data: this
 * only re-orders games the backend already returned. */
function pickFeatured(byKey: Map<string, LobbySection>): Game | undefined {
  // Never feature a paused/unfinished slot (Vault Breaker included) in the
  // one big landscape promo slot — see isFeaturableInHomeRails.
  const pools = ["popular", "originals", "trending"].map((k) =>
    (byKey.get(k)?.games ?? []).filter(isFeaturableInHomeRails)
  );
  for (const pool of pools) {
    const exclusive = pool.find((g) => g.tags?.includes("EXCLUSIVE"));
    if (exclusive) return exclusive;
  }
  for (const pool of pools) {
    if (pool.length > 0) return pool[0];
  }
  return undefined;
}

export default function CasinoHomePage() {
  const router = useRouter();
  const fetcher = useCallback(() => api.get<LobbySection[]>("/casino/sections"), []);
  const { data: sections, loading } = useFetch(fetcher);

  const promosFetcher = useCallback(() => api.get<Promotion[]>("/promotions?status=active"), []);
  const { data: promotions } = useFetch(promosFetcher);

  const byKey = useMemo(() => {
    const map = new Map<string, LobbySection>();
    (sections ?? []).forEach((section) => map.set(section.key, section));
    return map;
  }, [sections]);

  const featuredGame = useMemo(() => pickFeatured(byKey), [byKey]);

  // Only fall back to placeholder skeleton rows for every known rail when
  // the backend responded with nothing at all (e.g. the request failed).
  // If it responded but a section is legitimately empty (e.g. a
  // just-registered account has no Recently Played / Favorites yet), that
  // section is hidden rather than showing an empty state on the home page
  // — the dedicated /casino/recently-played and /casino/favorites pages
  // still show their own empty states for that.
  const fetchFailed = !loading && !sections;

  function renderRail(slot: RailSlot) {
    if (loading || fetchFailed) {
      return (
        <div key={slot.key} className="animate-fade-in-up">
          <GameRow title={slot.title} games={[]} loading={!fetchFailed} />
        </div>
      );
    }
    const section = byKey.get(slot.key);
    if (!section) return null;
    // Continue Playing / Popular / Trending / New Games must never feature
    // a paused/unfinished slot with a live "Play" affordance (product spec
    // item 9) — Originals is unaffected (it's always dice/mines/plinko) and
    // Favorites is left alone (a player's own deliberate pick, and still
    // genuinely playable either way).
    const games =
      slot.key === "favorites" || slot.key === "originals"
        ? section.games
        : section.games.filter(isFeaturableInHomeRails);
    if (games.length === 0) return null;
    return (
      <div key={slot.key} className="animate-fade-in-up">
        <GameRow title={slot.title} games={games} seeAllHref={slot.seeAllHref} />
      </div>
    );
  }

  const featuredPromos = (promotions ?? []).slice(0, 2);

  return (
    <div className="bg-casino-ambient py-6">
      <div className="mb-4 animate-fade-in-up px-4 lg:px-6">
        <PromoBanner />
      </div>

      <div className="mb-6 animate-fade-in-up">
        <CategoryBar />
      </div>

      {renderRail(CONTINUE_PLAYING)}

      <div className="bg-glow-originals">{HEAD_RAILS.map(renderRail)}</div>

      {!loading && !fetchFailed && featuredGame && (
        <div className="mb-8 animate-fade-in-up px-4 lg:px-6">
          <FeaturedGameCard game={featuredGame} />
        </div>
      )}

      {MID_RAILS.map(renderRail)}

      <div className="animate-fade-in-up">
        <LiveWins />
      </div>

      {renderRail(NEW_RAIL)}

      <div className="bg-glow-jackpot animate-fade-in-up px-4 lg:px-6">
        <JackpotDisplay />
      </div>

      <div className="mb-8 grid animate-fade-in-up grid-cols-1 gap-3 px-4 sm:grid-cols-2 lg:px-6">
        <DailyRewardCard />
        <VipProgressCard />
      </div>

      {featuredPromos.length > 0 && (
        <section className="bg-glow-promo mb-8 animate-fade-in-up px-4 lg:px-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-text-primary">Promotions</h2>
            <a href="/rewards/promotions" className="text-xs font-medium text-text-muted transition-colors hover:text-text-primary">
              See All
            </a>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {featuredPromos.map((promo, i) => (
              <PromoCard
                key={promo.id}
                promo={promo}
                claimed={false}
                claiming={false}
                onClaim={() => router.push("/rewards/promotions")}
                index={i}
              />
            ))}
          </div>
        </section>
      )}

      <div className="animate-fade-in-up">
        <ProviderRail />
      </div>

      {TAIL_RAILS.map(renderRail)}
    </div>
  );
}
