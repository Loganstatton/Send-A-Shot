"use client";

import { GameTile } from "@/components/casino/GameTile";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import type { Game } from "@/lib/types";

interface GameGridProps {
  games: Game[];
  loading: boolean;
  loadingMore?: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  emptyLabel?: string;
}

export function GameGrid({ games, loading, loadingMore, hasMore, onLoadMore, emptyLabel }: GameGridProps) {
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {loading &&
          Array.from({ length: 12 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="aspect-[3/4] w-full rounded-lg" />
              <Skeleton className="mt-2 h-3 w-3/4" />
            </div>
          ))}
        {!loading && games.map((g) => <GameTile key={g.id} game={g} />)}
      </div>

      {!loading && games.length === 0 && (
        <p className="py-16 text-center text-sm text-text-muted">{emptyLabel ?? "No games found."}</p>
      )}

      {!loading && hasMore && (
        <div className="mt-6 flex justify-center">
          <Button variant="secondary" onClick={onLoadMore} loading={loadingMore}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
