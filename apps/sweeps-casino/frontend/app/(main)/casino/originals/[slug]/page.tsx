import Link from "next/link";
import { DiceGame } from "@/components/casino/originals/DiceGame";
import { MinesGame } from "@/components/casino/originals/MinesGame";
import { PlinkoGame } from "@/components/casino/originals/PlinkoGame";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Dice } from "@/components/ui/icons";

const TITLES: Record<string, string> = { dice: "Dice", mines: "Mines", plinko: "Plinko" };

export default function OriginalGamePage({ params }: { params: { slug: string } }) {
  const { slug } = params;

  if (slug === "dice" || slug === "mines" || slug === "plinko") {
    return (
      <div className="p-4 lg:p-6">
        <h1 className="mb-4 text-xl font-bold text-text-primary">{TITLES[slug]}</h1>
        {slug === "dice" && <DiceGame />}
        {slug === "mines" && <MinesGame />}
        {slug === "plinko" && <PlinkoGame />}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <EmptyState
        icon={<Dice className="h-10 w-10" />}
        title={`${slug.charAt(0).toUpperCase() + slug.slice(1)} launches in Phase 2`}
        description="This Original isn't built yet — Phase 1 ships Dice, Mines, and Plinko against the shared provably-fair engine. More Originals (Crash, Limbo, Roulette, Blackjack, Keno) follow in Phase 2."
        phase="P2"
        action={
          <Link href="/casino/originals/dice">
            <Button variant="sc">Play Dice instead</Button>
          </Link>
        }
      />
    </div>
  );
}
