"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DiceGame } from "@/components/casino/originals/DiceGame";
import { MinesGame } from "@/components/casino/originals/MinesGame";
import { PlinkoGame } from "@/components/casino/originals/PlinkoGame";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { BalancePill } from "@/components/wallet/BalancePill";
import { CurrencySwitcher } from "@/components/wallet/CurrencySwitcher";
import { VaultlineLogo } from "@/components/ui/VaultlineLogo";
import { Dice, ChevronLeft, Star, StarFilled } from "@/components/ui/icons";
import { useFetch } from "@/lib/hooks/useFetch";
import { api } from "@/lib/api-client";
import type { Game } from "@/lib/types";
import { cn } from "@/lib/utils";

const TITLES: Record<string, string> = { dice: "Dice", mines: "Mines", plinko: "Plinko" };

/**
 * Minimal in-game header (Casino Visual Redesign sprint's "fullscreen game
 * mode"): Back, balance, active currency, favorite, game name. This page
 * lives in the (game) route group specifically so it renders without the
 * Sidebar/Topbar/MobileNav/ActivityPanel shell — see app/(game)/layout.tsx.
 */
function GameHeader({ slug, title }: { slug: string; title: string }) {
  const router = useRouter();
  const fetcher = useCallback(() => api.get<Game>(`/casino/games/${slug}`), [slug]);
  const { data: game } = useFetch(fetcher, [slug]);
  const [favorite, setFavorite] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const isFavorite = favorite ?? game?.isFavorite ?? false;

  async function toggleFavorite() {
    if (!game || busy) return;
    setBusy(true);
    const next = !isFavorite;
    setFavorite(next);
    try {
      if (next) {
        await api.post(`/casino/favorites/${game.id}`);
      } else {
        await api.delete(`/casino/favorites/${game.id}`);
      }
    } catch {
      setFavorite(!next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-bg/95 px-3 backdrop-blur sm:px-4">
      <button
        onClick={() => router.back()}
        aria-label="Back"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-text-muted hover:text-text-primary"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <Link href="/" className="hidden shrink-0 items-center gap-1.5 sm:flex">
        <VaultlineLogo className="h-6 w-6" />
      </Link>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-text-primary">{title}</p>
      </div>

      <div className="hidden sm:block">
        <CurrencySwitcher />
      </div>
      {/* BalancePill already shows the active currency's label next to the
          amount, so this one compact pill covers both the "Balance" and
          "Currency" requirements on narrow phones where the full
          two-button CurrencySwitcher wouldn't fit this header. */}
      <BalancePill alwaysVisible />

      {game && (
        <button
          onClick={toggleFavorite}
          aria-label="Toggle favorite"
          disabled={busy}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-text-muted transition-transform duration-150 ease-snappy hover:scale-110 hover:text-text-primary active:scale-90"
        >
          <span key={isFavorite ? "on" : "off"} className="inline-flex animate-pop">
            {isFavorite ? <StarFilled className={cn("h-4 w-4 text-accent-gc")} /> : <Star className="h-4 w-4" />}
          </span>
        </button>
      )}
    </header>
  );
}

export default function OriginalGamePage({ params }: { params: { slug: string } }) {
  const { slug } = params;
  const isKnownOriginal = slug === "dice" || slug === "mines" || slug === "plinko";
  const title = TITLES[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1);

  return (
    <div className="flex min-h-screen flex-col">
      <GameHeader slug={slug} title={title} />

      {isKnownOriginal ? (
        <main className="mx-auto w-full max-w-6xl flex-1 p-3 sm:p-6">
          {slug === "dice" && <DiceGame />}
          {slug === "mines" && <MinesGame />}
          {slug === "plinko" && <PlinkoGame />}
        </main>
      ) : (
        <main className="mx-auto flex w-full max-w-2xl flex-1 items-center p-6">
          <EmptyState
            icon={<Dice className="h-10 w-10" />}
            title={`${title} launches in Phase 2`}
            description="This Original isn't built yet — Phase 1 ships Dice, Mines, and Plinko against the shared provably-fair engine. More Originals (Crash, Limbo, Roulette, Blackjack, Keno) follow in Phase 2."
            phase="P2"
            action={
              <Link href="/casino/originals/dice">
                <Button variant="sc">Play Dice instead</Button>
              </Link>
            }
          />
        </main>
      )}
    </div>
  );
}
