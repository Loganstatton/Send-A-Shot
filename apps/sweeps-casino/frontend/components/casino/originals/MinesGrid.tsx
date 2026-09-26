"use client";

// The 5x5 Mines board — interactive, one tile at a time. Each tile is a
// secure vault/deposit panel rather than a flat UI button: unrevealed tiles
// read as brushed dark steel with a real beveled edge, a soft internal
// shadow, and a tiny armed teal indicator light; a safe pick makes the panel
// visually depress and pop back open with a gold/teal crystal inside and
// light spilling out behind it; the tile that actually busts the round gets
// a distinct, dramatic explosion treatment (shake + hard red glow), while
// the OTHER mines the server discloses afterward reveal calmer and dimmer —
// a "these were also live" disclosure, not a second explosion. Purely
// presentational — MinesGame owns all state and passes down one
// `MinesTileState` per tile.
import { CSSProperties } from "react";
import { Bomb, VaultGem } from "@/components/ui/icons";
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
        // Post-round disclosure (unhit mines + never-picked safe tiles)
        // fans out in a short stagger so the whole board reads as one
        // deliberate "revealing the vault" beat rather than every panel
        // popping at once — capped well inside the ~1-2s total the reveal
        // is meant to take.
        const revealDelayMs = state === "mine" || state === "skipped" ? Math.min(idx * 16, 380) : 0;
        const style: CSSProperties | undefined = revealDelayMs ? { animationDelay: `${revealDelayMs}ms` } : undefined;

        return (
          <div key={idx} className="relative">
            {/* Light spilling out from behind an opened safe panel — sized
                past the tile's own bounds so it reads as illumination, not
                a border glow. Lives on a non-clipped wrapper since the
                button itself clips its own content. */}
            {state === "safe" && (
              <span
                aria-hidden
                className="pointer-events-none absolute -inset-2.5 rounded-2xl blur-md"
                style={{
                  background:
                    "radial-gradient(circle, rgb(var(--color-accent-gc) / 0.42), rgb(var(--color-success) / 0.28) 45%, transparent 72%)",
                }}
              />
            )}
            {/* Harder, tighter danger bloom behind the tile that actually
                busts the round — the one moment that should feel violent. */}
            {state === "mine-hit" && (
              <span
                aria-hidden
                className="pointer-events-none absolute -inset-3 rounded-2xl blur-md"
                style={{
                  background: "radial-gradient(circle, rgb(var(--color-danger) / 0.55), transparent 70%)",
                }}
              />
            )}

            <button
              type="button"
              onClick={() => interactive && onPick(idx)}
              disabled={!interactive}
              style={style}
              aria-label={
                state === "safe"
                  ? `Tile ${idx + 1}, safe`
                  : state === "mine-hit"
                    ? `Tile ${idx + 1}, mine (hit)`
                    : state === "mine"
                      ? `Tile ${idx + 1}, mine (revealed)`
                      : state === "skipped"
                        ? `Tile ${idx + 1}, safe (not picked)`
                        : `Tile ${idx + 1}`
              }
              className={cn(
                "group relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl text-lg transition-all duration-200 ease-snappy",
                // Base "secure vault panel": brushed-steel gradient, a
                // crisp top bevel highlight, a hard dark seam just above a
                // deep inset shadow along the bottom, and a real drop
                // shadow underneath — reads as a raised physical deposit
                // panel rather than a flat color swap.
                (state === "default" || state === "pending") &&
                  "border-x border-t border-b-2 border-x-white/[0.05] border-t-white/10 border-b-black/50 bg-gradient-to-b from-surface-raised via-surface-raised to-bg shadow-[inset_0_1px_0_rgb(255_255_255/0.1),inset_0_-1px_0_rgb(0_0_0/0.55),inset_0_-4px_8px_rgb(0_0_0/0.45),0_3px_8px_rgb(0_0_0/0.35)]",
                state === "default" &&
                  "hover:-translate-y-0.5 hover:border-accent-sc/60 hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.14),inset_0_-4px_8px_rgb(0_0_0/0.45),0_6px_16px_rgb(0_0_0/0.4)] active:translate-y-0 active:scale-[0.94] active:shadow-[inset_0_2px_6px_rgb(0_0_0/0.55)]",
                state === "pending" && "scale-[0.97] border-accent-sc/60 cursor-wait",
                // Safe reveal: the panel "opens" (tile-open: a quick
                // mechanical depress-then-spring) into a lit gold/teal
                // cavity holding the crystal.
                state === "safe" &&
                  "animate-tile-open border border-success/50 bg-gradient-to-b from-black/50 via-surface to-surface-raised shadow-[inset_0_2px_5px_rgb(0_0_0/0.55),inset_0_-1px_0_rgb(255_255_255/0.15),0_0_18px_rgb(var(--color-success)/0.3)]",
                // Calm, dim disclosure — deliberately flatter than the
                // hit tile so it never competes with it for attention.
                state === "mine" &&
                  "animate-mine-reveal border border-danger/20 bg-gradient-to-b from-danger/15 to-danger/5 opacity-60",
                // The one dramatic tile: hard shake + saturated red bloom.
                state === "mine-hit" &&
                  "animate-shake border border-danger bg-gradient-to-b from-danger/60 via-danger/25 to-danger/10 shadow-[0_0_32px_rgb(var(--color-danger)/0.7),inset_0_1px_0_rgb(255_255_255/0.1)]",
                // Unpicked safe tiles, disclosed at cash-out/bust — a dim
                // echo of the real safe-panel treatment, not a blank void.
                state === "skipped" &&
                  "animate-mine-reveal border border-success/15 bg-gradient-to-b from-success/10 to-transparent opacity-45",
                !interactive && state !== "pending" && "cursor-not-allowed"
              )}
            >
              {state === "safe" && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-xl"
                  style={{
                    background:
                      "radial-gradient(circle at 50% 40%, rgb(var(--color-accent-gc) / 0.22), rgb(var(--color-success) / 0.12) 55%, transparent 80%)",
                  }}
                />
              )}

              {state === "pending" && (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent-sc border-t-transparent" />
              )}
              {state === "safe" && (
                <VaultGem
                  className="h-6 w-6 animate-pop"
                  style={{ filter: "drop-shadow(0 0 8px rgb(var(--color-accent-gc) / 0.75))" }}
                />
              )}
              {state === "mine-hit" && (
                <Bomb
                  className="h-6 w-6 text-white"
                  style={{ filter: "drop-shadow(0 0 10px rgb(var(--color-danger) / 0.9))" }}
                />
              )}
              {state === "mine" && <Bomb className="h-5 w-5 text-danger/80" />}
              {state === "skipped" && <VaultGem className="h-4 w-4 opacity-60" />}

              {/* Tiny "armed" indicator light on an untouched panel — the
                  cue that this tile is a live, pickable vault door. */}
              {state === "default" && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent-sc/80 shadow-[0_0_5px_1.5px_rgb(var(--color-accent-sc)/0.6)]"
                />
              )}

              {/* Subtle glass sheen across the top of every unrevealed tile. */}
              {(state === "default" || state === "pending") && (
                <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-xl bg-gradient-to-b from-white/[0.05] to-transparent" />
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
