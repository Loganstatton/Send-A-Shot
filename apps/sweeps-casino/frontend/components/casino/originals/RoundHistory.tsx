import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import type { OriginalRoundResult } from "@/lib/types";
import { formatCoins, cn } from "@/lib/utils";

export function RoundHistory({ rounds }: { rounds: OriginalRoundResult[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Round history</CardTitle>
      </CardHeader>
      <CardContent className="pt-3">
        {rounds.length === 0 ? (
          <p className="text-xs text-text-muted">No rounds yet this session.</p>
        ) : (
          <div className="space-y-1.5">
            {rounds.map((r) => (
              <div
                key={r.roundId}
                className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className={cn("h-1.5 w-1.5 rounded-full", r.win ? "bg-success" : "bg-danger")} />
                  <span className="text-text-muted">#{r.nonce}</span>
                </div>
                <span className="font-mono text-text-muted">{formatCoins(r.betAmount)}</span>
                <span className={cn("font-mono font-semibold", r.win ? "text-success" : "text-danger")}>
                  {r.win ? "+" : ""}
                  {formatCoins(r.win ? r.payout : -r.betAmount)}
                </span>
                <span className="font-mono text-text-muted">{r.multiplier.toFixed(2)}x</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
