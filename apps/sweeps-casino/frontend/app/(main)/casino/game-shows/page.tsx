import { EmptyState } from "@/components/ui/EmptyState";
import { Dice } from "@/components/ui/icons";

export default function GameShowsPage() {
  return (
    <div className="p-4 lg:p-6">
      <h1 className="mb-4 text-xl font-bold text-text-primary">Game Shows</h1>
      <EmptyState
        icon={<Dice className="h-10 w-10" />}
        title="Game Shows catalog seeds via provider integration"
        description="Interactive game-show titles arrive with the Phase 2 game aggregator integration. Vaultline Originals are fully playable today."
        phase="P2"
      />
    </div>
  );
}
