import { EmptyState } from "@/components/ui/EmptyState";
import { Dice } from "@/components/ui/icons";

export default function SlotsPage() {
  return (
    <div className="p-4 lg:p-6">
      <h1 className="mb-4 text-xl font-bold text-text-primary">Slots</h1>
      <EmptyState
        icon={<Dice className="h-10 w-10" />}
        title="Slots catalog is coming in Phase 2"
        description="Slots content ships once a third-party game aggregator is integrated (docs/04). Vaultline Originals — Dice, Mines, and Plinko — are fully playable today."
        phase="P2"
      />
    </div>
  );
}
