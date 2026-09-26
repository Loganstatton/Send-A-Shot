import { EmptyState } from "@/components/ui/EmptyState";
import { Trophy } from "@/components/ui/icons";

export default function ChallengesPage() {
  return (
    <div className="p-4 lg:p-6">
      <h1 className="mb-4 text-xl font-bold text-text-primary">Challenges</h1>
      <EmptyState
        icon={<Trophy className="h-10 w-10" />}
        title="Challenges are coming in Phase 2"
        description="The promotions engine already supports CHALLENGE-type rewards on the backend — Phase 1 just hasn't seeded any content yet. Check Promotions and Daily Bonus for what's live today."
        phase="P2"
      />
    </div>
  );
}
