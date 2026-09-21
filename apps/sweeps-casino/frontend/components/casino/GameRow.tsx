"use client";

import { useRef } from "react";
import Link from "next/link";
import { GameTile } from "@/components/casino/GameTile";
import { SkeletonRow } from "@/components/ui/Skeleton";
import { ChevronLeft, ChevronRight } from "@/components/ui/icons";
import type { Game } from "@/lib/types";

export function GameRow({
  title,
  games,
  loading,
  seeAllHref,
}: {
  title: string;
  games: Game[];
  loading?: boolean;
  seeAllHref?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  function scrollBy(delta: number) {
    scrollerRef.current?.scrollBy({ left: delta, behavior: "smooth" });
  }

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between gap-3 px-4 lg:px-6">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-text-primary">{title}</h2>
          {seeAllHref && (
            <Link
              href={seeAllHref}
              className="inline-flex items-center gap-0.5 text-xs font-medium text-text-muted transition-colors hover:text-text-primary"
            >
              See All
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
        {!loading && games.length > 0 && (
          <div className="hidden shrink-0 gap-1 sm:flex">
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
        <div
          ref={scrollerRef}
          className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 lg:px-6"
        >
          {games.map((g, i) => (
            <GameTile key={g.id} game={g} index={i} />
          ))}
        </div>
      )}
    </section>
  );
}
