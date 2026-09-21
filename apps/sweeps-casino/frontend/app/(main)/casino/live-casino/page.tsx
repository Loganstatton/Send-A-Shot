import { EmptyState } from "@/components/ui/EmptyState";
import { Dice } from "@/components/ui/icons";

export default function LiveCasinoPage() {
  return (
    <div className="p-4 lg:p-6">
      <h1 className="mb-4 text-xl font-bold text-text-primary">Live Casino</h1>
      <EmptyState
        icon={<Dice className="h-10 w-10" />}
        title="Live Casino launches once a provider is integrated"
        description="Live dealer tables require a licensed live-casino provider integration, planned for Phase 2. Vaultline Originals are fully playable today."
        phase="P2"
      />
    </div>
  );
}
