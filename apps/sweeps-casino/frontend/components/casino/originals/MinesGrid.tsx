"use client";

// The 5x5 Mines board: dark metallic unrevealed tiles, a glowing gem for a
// revealed safe tile, and a danger/explosion treatment for a revealed
// mine. Purely presentational — MinesGame owns all state and passes down
// one `MinesTileState` per tile.
import { Bomb, StarFilled } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export type MinesTileState = "default" | "selected" | "safe" | "mine" | "skipped";

interface MinesGridProps {
  tiles: MinesTileState[];
  onToggle: (idx: number) => void;
  disabled: boolean;
}

export function MinesGrid({ tiles, onToggle, disabled }: MinesGridProps) {
  return (
    <div className="mx-auto grid max-w-md grid-cols-5 gap-2 sm:gap-2.5 lg:max-w-2xl lg:gap-3.5">
      {tiles.map((state, idx) => {
        const interactive = !disabled && (state === "default" || state === "selected");
        return (
          <button
            key={idx}
            type="button"
            onClick={() => interactive && onToggle(idx)}
            disabled={!interactive}
            aria-pressed={state === "selected"}
            className={cn(
              "relative flex aspect-square items-center justify-center rounded-xl text-lg transition-all duration-200 ease-snappy",
              state === "default" &&
                "border border-border/80 bg-gradient-to-br from-surface-raised to-bg hover:-translate-y-0.5 hover:border-accent-sc/50",
              state === "selected" &&
                "scale-[1.03] border border-accent-sc bg-gradient-to-br from-accent-sc/25 to-accent-sc/10 shadow-glow-sc",
              state === "safe" &&
                "animate-scale-in border border-success/50 bg-gradient-to-br from-success/25 to-success/5",
              state === "mine" &&
                "animate-shake border border-danger bg-gradient-to-br from-danger/45 to-danger/10",
              state === "skipped" && "border border-border/30 bg-surface-raised/30 opacity-40",
              !interactive && "cursor-not-allowed"
            )}
            style={
              state === "safe"
                ? { boxShadow: "0 0 18px rgb(var(--color-success) / 0.4)" }
                : state === "mine"
                  ? { boxShadow: "0 0 26px rgb(var(--color-danger) / 0.6)" }
                  : undefined
            }
          >
            {state === "safe" && (
              <StarFilled
                className="h-5 w-5 text-accent-gc"
                style={{ filter: "drop-shadow(0 0 6px rgb(var(--color-accent-gc) / 0.7))" }}
              />
            )}
            {state === "mine" && <Bomb className="h-5 w-5 text-danger" />}
          </button>
        );
      })}
    </div>
  );
}
