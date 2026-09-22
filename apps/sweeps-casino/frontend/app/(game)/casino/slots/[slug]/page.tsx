"use client";

// Fullscreen game-mode route for real (built) slots — mirrors
// app/(game)/casino/originals/[slug]/page.tsx's pattern (lives in the
// (game) route group specifically so it renders without the Sidebar/
// Topbar/MobileNav/ActivityPanel shell). Vault Breaker is the only slot
// with a real engine today (lib/playable-games.ts); any other slug still
// resolves here (a direct URL, not a lobby tap — lobby cards are gated on
// GameTile itself) shows an honest "not available" state, never a dead
// blank page.
import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { VaultBreakerGame } from "@/components/casino/slots/vault-breaker/VaultBreakerGame";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { VaultlineLogo } from "@/components/ui/VaultlineLogo";
import { ChevronLeft, Reels, Star, StarFilled } from "@/components/ui/icons";
import { useFetch } from "@/lib/hooks/useFetch";
import { api } from "@/lib/api-client";
import { isPlayableSlot } from "@/lib/playable-games";
import type { Game } from "@/lib/types";
import { cn } from "@/lib/utils";

function SlotHeader({ slug, title }: { slug: string; title: string }) {
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
      if (next) await api.post(`/casino/favorites/${game.id}`);
      else await api.delete(`/casino/favorites/${game.id}`);
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

export default function SlotGamePage({ params }: { params: { slug: string } }) {
  const { slug } = params;
  const title = slug === "vault-breaker" ? "Vault Breaker" : slug.charAt(0).toUpperCase() + slug.slice(1);

  return (
    <div className="flex min-h-screen flex-col">
      <SlotHeader slug={slug} title={title} />

      {isPlayableSlot(slug) ? (
        // Top-aligned, not vertically centered: on a tall phone viewport,
        // centering the (intentionally compact) game card left equal dead
        // space above AND below it — the single most visible instance of
        // the "too much dead space" problem. Anchoring to the top instead
        // means any leftover space collects below the fold, not as a black
        // band bracketing the reels.
        <main className="bg-casino-ambient mx-auto flex w-full max-w-6xl flex-1 flex-col items-center p-3 pt-4 sm:p-6">
          <VaultBreakerGame />
        </main>
      ) : (
        <main className="mx-auto flex w-full max-w-2xl flex-1 items-center p-6">
          <EmptyState
            icon={<Reels className="h-10 w-10" />}
            title={`${title} isn't playable yet`}
            description="This slot is part of the growing Vaultline catalog, but only Vault Breaker has a real game engine behind it today."
            phase="P2"
            action={
              <Link href="/casino/slots/vault-breaker">
                <Button variant="sc">Play Vault Breaker instead</Button>
              </Link>
            }
          />
        </main>
      )}
    </div>
  );
}
