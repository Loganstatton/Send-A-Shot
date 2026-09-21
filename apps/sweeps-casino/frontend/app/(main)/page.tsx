"use client";

import { useCallback, useMemo } from "react";
import { PromoBanner } from "@/components/casino/PromoBanner";
import { CategoryBar } from "@/components/casino/CategoryBar";
import { LiveWins } from "@/components/casino/LiveWins";
import { JackpotDisplay } from "@/components/casino/JackpotDisplay";
import { ProviderRail } from "@/components/casino/ProviderRail";
import { DailyRewardCard } from "@/components/casino/DailyRewardCard";
import { VipProgressCard } from "@/components/casino/VipProgressCard";
import { GameRow } from "@/components/casino/GameRow";
import { useFetch } from "@/lib/hooks/useFetch";
import { api } from "@/lib/api-client";
import type { LobbySection } from "@/lib/types";

/**
 * Casino Visual Redesign sprint — home page composition (sprint spec items
 * 2-17; item 1 "compact top navigation" lives in the layout/Topbar, owned
 * by a different agent, not here).
 *
 * The backend (`GET /casino/sections`, see CatalogService.getSections) now
 * returns exactly these 11 sections with stable `key`s: recently-played,
 * popular, originals, trending, new-releases, slots, table-games,
 * live-casino, game-shows, jackpots, favorites. Order here is therefore
 * driven directly by this fixed list rather than inferred/sorted the way
 * the previous (Phase 1, thin-catalog) version of this file did. If the
 * backend ever adds a new section key, it needs to be added here
 * deliberately — unknown keys are no longer auto-appended.
 *
 * "See All" links only point at routes that actually exist (verified
 * against the app/(main)/casino/* and app/(main)/rewards/* route tree).
 * Where no dedicated browse page exists yet (Popular, Trending, Jackpots)
 * the link is omitted rather than pointing somewhere broken.
 */
interface RailSlot {
  key: string;
  title: string;
  seeAllHref?: string;
}

const HEAD_RAILS: RailSlot[] = [
  { key: "popular", title: "Popular Now" },
  { key: "originals", title: "Vaultline Originals", seeAllHref: "/casino/originals/dice" },
];

const MID_RAILS: RailSlot[] = [
  { key: "trending", title: "Trending" },
  { key: "new-releases", title: "New Releases", seeAllHref: "/casino/search?sort=new" },
  { key: "slots", title: "Slots", seeAllHref: "/casino/slots" },
  { key: "table-games", title: "Table Games", seeAllHref: "/casino/table-games" },
  { key: "live-casino", title: "Live Casino", seeAllHref: "/casino/live-casino" },
  { key: "game-shows", title: "Game Shows", seeAllHref: "/casino/game-shows" },
];

const JACKPOT_RAIL: RailSlot = { key: "jackpots", title: "Jackpots" };

const TAIL_RAILS: RailSlot[] = [
  { key: "recently-played", title: "Recently Played", seeAllHref: "/casino/recently-played" },
  { key: "favorites", title: "Favorites", seeAllHref: "/casino/favorites" },
];

export default function CasinoHomePage() {
  const fetcher = useCallback(() => api.get<LobbySection[]>("/casino/sections"), []);
  const { data: sections, loading } = useFetch(fetcher);

  const byKey = useMemo(() => {
    const map = new Map<string, LobbySection>();
    (sections ?? []).forEach((section) => map.set(section.key, section));
    return map;
  }, [sections]);

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
    if (!section || section.games.length === 0) return null;
    return (
      <div key={slot.key} className="animate-fade-in-up">
        {/* seeAllHref renders a "See All ->" link next to the title once
            GameRow supports it — see components/casino/GameRow.tsx. */}
        <GameRow title={section.title} games={section.games} seeAllHref={slot.seeAllHref} />
      </div>
    );
  }

  return (
    <div className="bg-casino-ambient py-6">
      <div className="mb-4 animate-fade-in-up px-4 lg:px-6">
        <PromoBanner />
      </div>

      <div className="mb-6 animate-fade-in-up">
        <CategoryBar />
      </div>

      {HEAD_RAILS.map(renderRail)}

      <div className="animate-fade-in-up">
        <LiveWins />
      </div>

      {MID_RAILS.map(renderRail)}

      {(loading || (byKey.get(JACKPOT_RAIL.key)?.games.length ?? 0) > 0 || fetchFailed) && (
        <div className="animate-fade-in-up px-4 lg:px-6">
          <JackpotDisplay />
        </div>
      )}
      {renderRail(JACKPOT_RAIL)}

      <div className="animate-fade-in-up">
        <ProviderRail />
      </div>

      <div className="mb-8 grid animate-fade-in-up grid-cols-1 gap-3 px-4 sm:grid-cols-2 lg:px-6">
        <DailyRewardCard />
        <VipProgressCard />
      </div>

      {TAIL_RAILS.map(renderRail)}
    </div>
  );
}
