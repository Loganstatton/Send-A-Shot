"use client";

import { useRef } from "react";
import { GameTile } from "@/components/casino/GameTile";
import { SkeletonRow } from "@/components/ui/Skeleton";
import { ChevronLeft, ChevronRight } from "@/components/ui/icons";
import type { Game } from "@/lib/types";

export function GameRow({ title, games, loading }: { title: string; games: Game[]; loading?: boolean }) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  function scrollBy(delta: number) {
    scrollerRef.current?.scrollBy({ left: delta, behavior: "smooth" });
  }

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between px-4 lg:px-6">
        <h2 className="text-lg font-bold text-text-primary">{title}</h2>
        {!loading && games.length > 0 && (
          <div className="hidden gap-1 sm:flex">
            <button
              onClick={() => scrollBy(-400)}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-text-muted hover:text-text-primary"
              aria-label="Scroll left"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => scrollBy(400)}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-text-muted hover:text-text-primary"
              aria-label="Scroll right"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {loading && (
        <div className="px-4 lg:px-6">
          <SkeletonRow />
        </div>
      )}

      {!loading && games.length === 0 && (
        <p className="px-4 text-sm text-text-muted lg:px-6">Nothing here yet.</p>
      )}

      {!loading && games.length > 0 && (
        <div ref={scrollerRef} className="no-scrollbar flex gap-3 overflow-x-auto px-4 pb-1 lg:px-6">
          {games.map((g) => (
            <GameTile key={g.id} game={g} />
          ))}
        </div>
      )}
    </section>
  );
}
