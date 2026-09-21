"use client";

import { useCallback } from "react";
import { PromoBanner } from "@/components/casino/PromoBanner";
import { DailyRewardCard } from "@/components/casino/DailyRewardCard";
import { VipProgressCard } from "@/components/casino/VipProgressCard";
import { GameRow } from "@/components/casino/GameRow";
import { useFetch } from "@/lib/hooks/useFetch";
import { api } from "@/lib/api-client";
import type { LobbySection } from "@/lib/types";
import { BalancePill } from "@/components/wallet/BalancePill";

export default function CasinoHomePage() {
  const fetcher = useCallback(() => api.get<LobbySection[]>("/casino/sections"), []);
  const { data: sections, loading } = useFetch(fetcher);

  const skeletonSections = ["Recently Played", "Favorites", "Originals", "Trending", "New Releases"];

  return (
    <div className="py-6">
      <div className="mb-6 px-4 lg:px-6">
        <PromoBanner />
      </div>

      <div className="mb-8 grid grid-cols-1 gap-3 px-4 sm:grid-cols-2 lg:px-6">
        <DailyRewardCard />
        <VipProgressCard />
      </div>

      <div className="mb-6 px-4 md:hidden">
        <BalancePill />
      </div>

      {loading &&
        skeletonSections.map((title) => <GameRow key={title} title={title} games={[]} loading />)}

      {!loading &&
        (sections && sections.length > 0 ? (
          sections.map((section) => <GameRow key={section.key} title={section.title} games={section.games} />)
        ) : (
          skeletonSections.map((title) => <GameRow key={title} title={title} games={[]} />)
        ))}
    </div>
  );
}
