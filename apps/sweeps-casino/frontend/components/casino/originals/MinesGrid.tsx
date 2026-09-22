"use client";

// The 5x5 Mines board — interactive, one tile at a time. Unrevealed tiles
// read as pressable metal/glass (layered gradient + inset highlight/shadow,
// a real lift on hover, a real press on tap), a revealed safe tile pops in
// as a glowing gem, and the tile that actually busts the round gets a
// distinct explosion treatment (shake + hard red glow) from the other
// mines the server reveals afterward, which fade in calmer/dimmer since
// the player never touched them. Purely presentational — MinesGame owns
// all state and passes down one `MinesTileState` per tile.
import { Bomb, StarFilled } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export type MinesTileState = "default" | "pending" | "safe" | "mine-hit" | "mine" | "skipped";

interface MinesGridProps {
  tiles: MinesTileState[];
  onPick: (idx: number) => void;
  disabled: boolean;
}

export function MinesGrid({ tiles, onPick, disabled }: MinesGridProps) {
  return (
    <div className="mx-auto grid max-w-md grid-cols-5 gap-2 sm:gap-2.5 lg:max-w-2xl lg:gap-3.5">
      {tiles.map((state, idx) => {
        const interactive = !disabled && state === "default";
        return (
          <button
            key={idx}
            type="button"
            onClick={() => interactive && onPick(idx)}
            disabled={!interactive}
            aria-label={
              state === "safe"
                ? `Tile ${idx + 1}, safe`
                : state === "mine-hit" || state === "mine"
                  ? `Tile ${idx + 1}, mine`
                  : `Tile ${idx + 1}`
            }
            className={cn(
              "group relative flex aspect-square items-center justify-center overflow-hidden rounded-xl text-lg transition-all duration-200 ease-snappy",
              // Base "metal/glass" tile: layered gradient + an inset
              // highlight along the top and a soft inset shadow along the
              // bottom, so it reads as a physical raised button rather
              // than a flat color swap.
              (state === "default" || state === "pending") &&
                "border border-border/80 bg-gradient-to-b from-surface-raised via-surface-raised to-bg shadow-[inset_0_1px_0_rgb(255_255_255/0.06),inset_0_-3px_6px_rgb(0_0_0/0.35),0_2px_6px_rgb(0_0_0/0.25)]",
              state === "default" &&
                "hover:-translate-y-0.5 hover:border-accent-sc/60 hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.1),inset_0_-3px_6px_rgb(0_0_0/0.35),0_6px_16px_rgb(0_0_0/0.35)] active:translate-y-0 active:scale-[0.94] active:shadow-[inset_0_2px_6px_rgb(0_0_0/0.5)]",
              state === "pending" && "scale-[0.97] border-accent-sc/60 cursor-wait",
              state === "safe" &&
                "animate-scale-in border border-success/60 bg-gradient-to-b from-success/30 via-success/10 to-success/5 shadow-[inset_0_1px_0_rgb(255_255_255/0.15),0_0_20px_rgb(var(--color-success)/0.35)]",
              state === "mine-hit" &&
                "animate-shake border border-danger bg-gradient-to-b from-danger/60 via-danger/25 to-danger/10 shadow-[0_0_32px_rgb(var(--color-danger)/0.7),inset_0_1px_0_rgb(255_255_255/0.1)]",
              state === "mine" &&
                "animate-scale-in border border-danger/30 bg-gradient-to-b from-danger/20 to-danger/5 opacity-70",
              state === "skipped" && "border border-border/30 bg-surface-raised/20 opacity-35",
              !interactive && state !== "pending" && "cursor-not-allowed"
            )}
          >
            {state === "pending" && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent-sc border-t-transparent" />
            )}
            {state === "safe" && (
              <StarFilled
                className="h-5 w-5 animate-pop text-accent-gc"
                style={{ filter: "drop-shadow(0 0 8px rgb(var(--color-accent-gc) / 0.8))" }}
              />
            )}
            {state === "mine-hit" && (
              <Bomb
                className="h-6 w-6 text-white"
                style={{ filter: "drop-shadow(0 0 10px rgb(var(--color-danger) / 0.9))" }}
              />
            )}
            {state === "mine" && <Bomb className="h-5 w-5 text-danger/80" />}

            {/* Subtle glass sheen across the top of every unrevealed tile. */}
            {(state === "default" || state === "pending") && (
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-xl bg-gradient-to-b from-white/[0.05] to-transparent" />
            )}
          </button>
        );
      })}
    </div>
  );
}
