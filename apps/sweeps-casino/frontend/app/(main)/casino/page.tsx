"use client";

// Casino Visual Redesign sprint — the "Casino" bottom-nav destination
// (spec item 27). Nav-config.ts gets repointed at this route by a
// different agent; this file just needs to exist and behave like the
// tab's real landing page once that happens.
//
// Deliberately utilitarian where Home (app/(main)/page.tsx) is curated:
// a prominent search box, filter pills, and — for the default "All, no
// search" view — a handful of quick category rails (from the same
// `GET /casino/sections` the Home page uses) followed by the full,
// densely-packed game library. Once a filter or search query is active,
// it drops straight to a single dense grid via `GET /casino/games`
// (same cursor-pagination pattern as app/(main)/casino/slots/page.tsx).

import { Suspense, useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { GameGrid } from "@/components/casino/GameGrid";
import { GameRow } from "@/components/casino/GameRow";
import { ProviderRail } from "@/components/casino/ProviderRail";
import { useCursorList } from "@/lib/hooks/useCursorList";
import { useFetch } from "@/lib/hooks/useFetch";
import { useDebounce } from "@/lib/hooks/useDebounce";
import { api } from "@/lib/api-client";
import type { CursorPage, Game, LobbySection } from "@/lib/types";
import { Search, Dice, Reels, Cards, Users, Star, Trophy } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

interface FilterDef {
  key: string;
  label: string;
  icon?: typeof Dice;
  category?: string;
  tag?: string;
  sort?: "featured" | "new";
  favoritesOnly?: true;
}

// Exactly the pills the redesign spec calls for (All/Originals/Slots/
// Table/Live/New/Favorites), plus one bonus "Jackpots" pill so
// JackpotDisplay's "View Jackpot Games" CTA (which links to
// /casino?filter=jackpots) lands somewhere real instead of a dead link.
const FILTERS: FilterDef[] = [
  { key: "all", label: "All" },
  { key: "originals", label: "Originals", icon: Dice, category: "ORIGINALS" },
  { key: "slots", label: "Slots", icon: Reels, category: "SLOTS" },
  { key: "table", label: "Table", icon: Cards, category: "TABLE_GAMES" },
  { key: "live", label: "Live", icon: Users, category: "LIVE_CASINO" },
  { key: "new", label: "New", sort: "new" },
  { key: "jackpots", label: "Jackpots", icon: Trophy, tag: "JACKPOT" },
  { key: "favorites", label: "Favorites", icon: Star, favoritesOnly: true },
];

const QUICK_RAILS: { key: string; title: string }[] = [
  { key: "originals", title: "Vaultline Originals" },
  { key: "slots", title: "Slots" },
  { key: "table-games", title: "Table Games" },
  { key: "live-casino", title: "Live Casino" },
  { key: "game-shows", title: "Game Shows" },
  { key: "new-releases", title: "New Releases" },
];

function CasinoBody() {
  const params = useSearchParams();
  const initialFilter = params.get("filter") ?? "all";
  const [filterKey, setFilterKey] = useState(FILTERS.some((f) => f.key === initialFilter) ? initialFilter : "all");
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 350);
  const filter = FILTERS.find((f) => f.key === filterKey) ?? FILTERS[0];
  const isDefaultView = filterKey === "all" && !debouncedQuery;

  const fetchPage = useCallback(
    (cursor: string | null) => {
      const qs = new URLSearchParams();
      if (debouncedQuery) qs.set("q", debouncedQuery);
      if (filter.category) qs.set("category", filter.category);
      if (filter.tag) qs.set("tag", filter.tag);
      qs.set("sort", filter.sort ?? "featured");
      if (filter.favoritesOnly) qs.set("favoritesOnly", "true");
      if (cursor) qs.set("cursor", cursor);
      return api.get<CursorPage<Game>>(`/casino/games?${qs.toString()}`);
    },
    [debouncedQuery, filter]
  );
  const { items, loading, loadingMore, hasMore, loadMore } = useCursorList(fetchPage, [debouncedQuery, filterKey]);

  // Quick category rails — only fetched/rendered for the default landing
  // view; on a filtered or searched view the dense grid above is the
  // whole point, so these would just be redundant clutter.
  const sectionsFetcher = useCallback(() => api.get<LobbySection[]>("/casino/sections"), []);
  const { data: sections } = useFetch(sectionsFetcher);
  const sectionsByKey = useMemo(() => {
    const map = new Map<string, LobbySection>();
    (sections ?? []).forEach((s) => map.set(s.key, s));
    return map;
  }, [sections]);

  const emptyLabel = debouncedQuery
    ? `No games match "${debouncedQuery}".`
    : filter.key === "favorites"
    ? "No favorites yet — tap the star on a game to add one."
    : "No games in this category right now.";

  return (
    <div className="bg-casino-ambient p-4 lg:p-6">
      <h1 className="mb-1 text-xl font-bold text-text-primary">Casino</h1>
      <p className="mb-4 text-sm text-text-muted">Search the full library, or browse by category.</p>

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search games"
          className="w-full rounded-xl border border-border bg-surface-raised py-3 pl-10 pr-3.5 text-sm text-text-primary placeholder:text-text-muted/70 outline-none transition-colors focus:border-accent-sc"
        />
      </div>

      <div className="no-scrollbar mb-6 flex snap-x snap-mandatory gap-2 overflow-x-auto">
        {FILTERS.map((f) => {
          const Icon = f.icon;
          const active = f.key === filterKey;
          return (
            <button
              key={f.key}
              onClick={() => setFilterKey(f.key)}
              className={cn(
                "flex h-9 shrink-0 snap-start items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-xs font-semibold transition-colors",
                active
                  ? "border-accent-gc/40 bg-accent-gc/12 text-accent-gc"
                  : "border-border/70 bg-surface/60 text-text-muted hover:border-border hover:text-text-primary"
              )}
            >
              {Icon && <Icon className="h-3.5 w-3.5" />}
              {f.label}
            </button>
          );
        })}
      </div>

      {isDefaultView && (
        <div className="mb-2">
          {QUICK_RAILS.map((rail) => {
            const section = sectionsByKey.get(rail.key);
            if (!section || section.games.length === 0) return null;
            return (
              <div key={rail.key} className="-mx-4 lg:-mx-6">
                <GameRow title={section.title} games={section.games} />
              </div>
            );
          })}
          <div className="-mx-4 mb-2 lg:-mx-6">
            <ProviderRail />
          </div>
          <h2 className="mb-3 text-lg font-bold text-text-primary">Full Library</h2>
        </div>
      )}

      <GameGrid
        games={items}
        loading={loading}
        loadingMore={loadingMore}
        hasMore={hasMore}
        onLoadMore={loadMore}
        emptyLabel={emptyLabel}
      />
    </div>
  );
}

export default function CasinoPage() {
  return (
    <Suspense fallback={null}>
      <CasinoBody />
    </Suspense>
  );
}
