"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useFetch } from "@/lib/hooks/useFetch";
import { api } from "@/lib/api-client";
import type { Game } from "@/lib/types";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { Dice } from "@/components/ui/icons";

const ORIGINALS_SLUGS = ["dice", "mines", "plinko"];

export default function GameDetailPage({ params }: { params: { slug: string } }) {
  const router = useRouter();
  const fetcher = useCallback(() => api.get<Game>(`/casino/games/${params.slug}`), [params.slug]);
  const { data: game, loading } = useFetch(fetcher, [params.slug]);

  useEffect(() => {
    if (game && ORIGINALS_SLUGS.includes(game.slug)) {
      router.replace(`/casino/originals/${game.slug}`);
    }
  }, [game, router]);

  if (loading) {
    return (
      <div className="p-6">
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!game) {
    return (
      <div className="p-6">
        <EmptyState title="Game not found" description="This game isn't in the catalog yet." />
      </div>
    );
  }

  if (ORIGINALS_SLUGS.includes(game.slug)) return null;

  return (
    <div className="mx-auto max-w-2xl p-6">
      <EmptyState
        icon={<Dice className="h-10 w-10" />}
        title={`${game.name} is coming soon`}
        description={`${game.name} is part of the growing Vaultline lobby — this card isn't playable yet. Vaultline Originals (Dice, Mines, Plinko) are fully playable today.`}
        phase="P2"
        action={
          <Link href="/casino/originals/dice">
            <Button variant="sc">Play a Vaultline Original</Button>
          </Link>
        }
      />
    </div>
  );
}
