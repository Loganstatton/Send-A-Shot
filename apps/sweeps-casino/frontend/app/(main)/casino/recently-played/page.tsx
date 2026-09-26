"use client";

import { useCallback } from "react";
import { GameGrid } from "@/components/casino/GameGrid";
import { useFetch } from "@/lib/hooks/useFetch";
import { api } from "@/lib/api-client";
import type { Game } from "@/lib/types";

export default function RecentlyPlayedPage() {
  const fetcher = useCallback(() => api.get<Game[]>("/casino/recently-played"), []);
  const { data, loading } = useFetch(fetcher);

  return (
    <div className="p-4 lg:p-6">
      <h1 className="mb-4 text-xl font-bold text-text-primary">Recently Played</h1>
      <GameGrid
        games={data ?? []}
        loading={loading}
        hasMore={false}
        onLoadMore={() => {}}
        emptyLabel="You haven't played anything yet — jump into a Vaultline Original."
      />
    </div>
  );
}
