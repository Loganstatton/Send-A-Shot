// Restyled as compact horizontal pills (Casino Visual Redesign, Phase C —
// spec item 33): a scrollable strip of recent rounds instead of a bordered
// list block, so it reads as a light trailing detail rather than another
// boxed panel competing with the game board for attention. Same
// `{ rounds }` prop contract as before.
import type { OriginalRoundResult } from "@/lib/types";
import { formatCoins, cn } from "@/lib/utils";

export function RoundHistory({ rounds }: { rounds: OriginalRoundResult[] }) {
  if (rounds.length === 0) {
    return <p className="px-1 text-xs text-text-muted">No rounds yet this session.</p>;
  }

  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-text-muted">History</span>
      <div className="no-scrollbar flex flex-1 gap-1.5 overflow-x-auto py-0.5">
        {rounds.slice(0, 25).map((r) => (
          <div
            key={r.roundId}
            // r.betAmount/payout come back from useOriginalGame as plain
            // dollar decimals (see fromPlayResponse), not minor units, so
            // formatCoins (which divides by 100) needs the *100 here —
            // matching the same fixup other dollar-decimal call sites in
            // this app apply before calling formatCoins.
            title={`#${r.nonce} · bet ${formatCoins(r.betAmount * 100)} · ${r.multiplier.toFixed(2)}x`}
            className={cn(
              "flex shrink-0 items-center rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold transition-transform duration-150",
              r.win
                ? "bg-success/15 text-success shadow-[0_0_0_1px_rgb(var(--color-success)/0.25)]"
                : "bg-surface-raised text-text-muted"
            )}
          >
            {r.multiplier.toFixed(2)}x
          </div>
        ))}
      </div>
    </div>
  );
}
