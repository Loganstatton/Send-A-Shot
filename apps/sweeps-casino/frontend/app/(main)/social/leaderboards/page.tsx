import { EmptyState } from "@/components/ui/EmptyState";
import { Trophy } from "@/components/ui/icons";

export default function LeaderboardsPage() {
  return (
    <div className="p-4 lg:p-6">
      <h1 className="mb-4 text-xl font-bold text-text-primary">Leaderboards</h1>
      <EmptyState
        icon={<Trophy className="h-10 w-10" />}
        title="Leaderboards are coming in Phase 2"
        description="Ranked wager/win leaderboards ship once VIP scoring and anonymization preferences are finalized. See the right-hand activity panel for real-time play activity today."
        phase="P2"
      />
    </div>
  );
}
