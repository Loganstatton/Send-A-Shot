"use client";

import { useCallback, useMemo } from "react";
import { PromoBanner } from "@/components/casino/PromoBanner";
import { DailyRewardCard } from "@/components/casino/DailyRewardCard";
import { VipProgressCard } from "@/components/casino/VipProgressCard";
import { GameRow } from "@/components/casino/GameRow";
import { useFetch } from "@/lib/hooks/useFetch";
import { api } from "@/lib/api-client";
import type { LobbySection } from "@/lib/types";
import { BalancePill } from "@/components/wallet/BalancePill";

/**
 * Sprint's explicit home hierarchy (item 8): Hero banner, Daily
 * Bonus/rewards shortcut, Recently Played, Vaultline Originals, Trending,
 * Popular, New Releases, Favorites. The backend (`GET /casino/sections`,
 * see CatalogService.getSections) doesn't return sections in this order and
 * has no "Popular" key at all today — so the ordering is enforced here on
 * the frontend by matching each returned section's `key` against this list
 * (case-insensitively, tolerant of naming variance) rather than assuming
 * the backend already agrees. Anything the backend sends that doesn't match
 * a known slot is appended at the end, in its original order, so real
 * backend content is never silently dropped.
 */
const HOME_SECTION_ORDER: { canonical: string; aliases: string[] }[] = [
  { canonical: "recently-played", aliases: ["recently-played", "recently_played", "recentlyplayed", "recent"] },
  {
    canonical: "originals",
    aliases: ["originals", "vaultline-originals", "vaultline_originals", "vaultlineoriginals"],
  },
  { canonical: "trending", aliases: ["trending"] },
  { canonical: "popular", aliases: ["popular"] },
  { canonical: "new-releases", aliases: ["new-releases", "new_releases", "newreleases", "new-release"] },
  { canonical: "favorites", aliases: ["favorites", "favourites", "favorite", "favourite"] },
];

function slotIndex(key: string): number {
  const k = key.toLowerCase();
  const idx = HOME_SECTION_ORDER.findIndex((slot) => slot.aliases.includes(k));
  return idx === -1 ? HOME_SECTION_ORDER.length : idx;
}

export default function CasinoHomePage() {
  const fetcher = useCallback(() => api.get<LobbySection[]>("/casino/sections"), []);
  const { data: sections, loading } = useFetch(fetcher);

  const skeletonSections = ["Recently Played", "Vaultline Originals", "Trending", "New Releases", "Favorites"];

  // Sort the backend's sections into the sprint's hierarchy, then hide any
  // section with no games once loading has finished — Phase 1's thin
  // catalog (3 Originals, no slots/live-casino) means several of these
  // will legitimately be empty right now, and repeating "Nothing here yet."
  // 5-8 times down the page is worse than just not showing the section.
  // GameRow's own empty state is left intact for other call-sites (e.g. the
  // dedicated Favorites page) that still want it.
  const orderedSections = useMemo(() => {
    if (!sections) return [];
    return sections
      .map((section, i) => ({ section, i, slot: slotIndex(section.key) }))
      .sort((a, b) => a.slot - b.slot || a.i - b.i)
      .map((x) => x.section)
      .filter((section) => section.games.length > 0);
  }, [sections]);

  return (
    <div className="py-6">
      <div className="mb-6 px-4 lg:px-6">
        <PromoBanner />
      </div>

      {/* Daily Bonus / rewards shortcut. VipProgressCard rides alongside it
          as a secondary highlight — the sprint's named hierarchy below is
          strictly the 6 game/reward sections, not this card. */}
      <div className="mb-8 grid grid-cols-1 gap-3 px-4 sm:grid-cols-2 lg:px-6">
        <DailyRewardCard />
        <VipProgressCard />
      </div>

      <div className="mb-6 px-4 md:hidden">
        <BalancePill />
      </div>

      {loading &&
        skeletonSections.map((title) => <GameRow key={title} title={title} games={[]} loading />)}

      {!loading && orderedSections.length > 0 && (
        <>
          {orderedSections.map((section) => (
            <div key={section.key} className="animate-fade-in-up">
              <GameRow title={section.title} games={section.games} />
            </div>
          ))}
        </>
      )}

      {/* Only fall back to placeholder rows when the backend gave us
          nothing at all (e.g. request failed) — if it responded but every
          section is legitimately empty, showing 5-8 "Nothing here yet."
          rows is exactly what the sprint asks us to avoid, so we show
          nothing instead. */}
      {!loading && !sections && skeletonSections.map((title) => <GameRow key={title} title={title} games={[]} />)}
    </div>
  );
}
