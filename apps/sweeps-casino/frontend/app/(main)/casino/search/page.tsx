"use client";

import { Suspense, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { GameGrid } from "@/components/casino/GameGrid";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useDebounce } from "@/lib/hooks/useDebounce";
import { useCursorList } from "@/lib/hooks/useCursorList";
import { api } from "@/lib/api-client";
import type { CursorPage, Game } from "@/lib/types";
import { Search as SearchIcon } from "@/components/ui/icons";

const CATEGORIES = ["", "originals", "slots", "live-casino", "table-games", "game-shows"];
const SORTS = [
  { value: "", label: "Relevance" },
  { value: "popular", label: "Most Popular" },
  { value: "new", label: "Newest" },
  { value: "az", label: "A–Z" },
];

function SearchBody() {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [category, setCategory] = useState(params.get("category") ?? "");
  const [provider, setProvider] = useState(params.get("provider") ?? "");
  const [sort, setSort] = useState(params.get("sort") ?? "");
  const debouncedQuery = useDebounce(query, 350);

  const fetchPage = useCallback(
    (cursor: string | null) => {
      const qs = new URLSearchParams();
      if (debouncedQuery) qs.set("q", debouncedQuery);
      if (category) qs.set("category", category);
      if (provider) qs.set("provider", provider);
      if (sort) qs.set("sort", sort);
      if (cursor) qs.set("cursor", cursor);
      return api.get<CursorPage<Game>>(`/casino/games?${qs.toString()}`);
    },
    [debouncedQuery, category, provider, sort]
  );

  const { items, loading, loadingMore, hasMore, loadMore } = useCursorList(fetchPage, [
    debouncedQuery,
    category,
    provider,
    sort,
  ]);

  return (
    <div className="p-4 lg:p-6">
      <h1 className="mb-4 text-xl font-bold text-text-primary">Search games</h1>

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by game or provider..."
            rightAdornment={<SearchIcon className="h-4 w-4" />}
          />
        </div>
        <Select value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c ? c.replace("-", " ") : "All categories"}
            </option>
          ))}
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value)}>
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </div>

      <GameGrid
        games={items}
        loading={loading}
        loadingMore={loadingMore}
        hasMore={hasMore}
        onLoadMore={loadMore}
        emptyLabel="No games match your search yet."
      />
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchBody />
    </Suspense>
  );
}
