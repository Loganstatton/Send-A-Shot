"use client";

import { useCallback } from "react";
import { GameGrid } from "@/components/casino/GameGrid";
import { useCursorList } from "@/lib/hooks/useCursorList";
import { api } from "@/lib/api-client";
import type { CursorPage, Game } from "@/lib/types";

export default function SlotsPage() {
  const fetchPage = useCallback((cursor: string | null) => {
    const qs = new URLSearchParams({ category: "SLOTS", sort: "featured" });
    if (cursor) qs.set("cursor", cursor);
    return api.get<CursorPage<Game>>(`/casino/games?${qs.toString()}`);
  }, []);

  const { items, loading, loadingMore, hasMore, loadMore } = useCursorList(fetchPage, []);

  return (
    <div className="p-4 lg:p-6">
      <h1 className="mb-4 text-xl font-bold text-text-primary">Slots</h1>
      <GameGrid
        games={items}
        loading={loading}
        loadingMore={loadingMore}
        hasMore={hasMore}
        onLoadMore={loadMore}
        emptyLabel="No slots available right now — check back soon."
      />
    </div>
  );
}
