"use client";

// The always-visible Dice game board: a large 0-100 range track with a
// red/loss vs teal/win gradient split at the target, a drag/tap-to-set
// handle, and a large center readout that the parent animates by cycling
// through random values before settling exactly on the real roll (the
// backend resolves the round instantly — this is a pure presentation
// animation; the credited result never changes).
import { useRef } from "react";
import { cn, formatCoins } from "@/lib/utils";

interface DiceRangeVisualProps {
  target: number;
  direction: "over" | "under";
  onTargetChange: (next: number) => void;
  disabled: boolean;
  displayRoll: number | null;
  phase: "idle" | "rolling" | "settled";
  win: boolean | null;
  payoutMinor: number | null;
  bigWin: boolean;
}

export function DiceRangeVisual({
  target,
  direction,
  onTargetChange,
  disabled,
  displayRoll,
  phase,
  win,
  payoutMinor,
  bigWin,
}: DiceRangeVisualProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  function valueFromClientX(clientX: number) {
    const el = trackRef.current;
    if (!el) return target;
    const rect = el.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.min(98, Math.max(2, Math.round(pct * 10000) / 100));
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    draggingRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    onTargetChange(valueFromClientX(e.clientX));
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current || disabled) return;
    onTargetChange(valueFromClientX(e.clientX));
  }
  function onPointerUp() {
    draggingRef.current = false;
  }

  const winZoneStyle: React.CSSProperties =
    direction === "over" ? { left: `${target}%`, right: 0 } : { left: 0, right: `${100 - target}%` };
  const lossZoneStyle: React.CSSProperties =
    direction === "over" ? { left: 0, right: `${100 - target}%` } : { left: `${target}%`, right: 0 };

  const rollPct = displayRoll != null ? Math.min(100, Math.max(0, displayRoll)) : null;

  return (
    <div className="select-none">
      <div className="relative flex min-h-[150px] flex-col items-center justify-center overflow-hidden rounded-2xl">
        {phase === "idle" ? (
          <p className="text-sm text-text-muted">Set your target, then roll.</p>
        ) : (
          <>
            <p
              className={cn(
                "font-mono text-6xl font-black tabular-nums sm:text-7xl",
                phase === "rolling" && "text-text-primary",
                phase === "settled" && win && "animate-pop text-success",
                phase === "settled" && win === false && "animate-pop text-danger"
              )}
              style={
                phase === "settled" && win
                  ? {
                      textShadow: bigWin
                        ? "0 0 26px rgb(var(--color-accent-gc) / 0.75), 0 0 58px rgb(var(--color-accent-gc) / 0.35)"
                        : "0 0 20px rgb(var(--color-success) / 0.45)",
                    }
                  : undefined
              }
            >
              {displayRoll != null ? displayRoll.toFixed(2) : "--.--"}
            </p>
            {phase === "settled" && (
              <p
                className={cn(
                  "mt-2 animate-win-enter text-sm font-bold",
                  win ? "text-success" : "text-danger",
                  bigWin && "text-base text-accent-gc"
                )}
              >
                {win ? `WIN · +${formatCoins(payoutMinor ?? 0)}` : "LOSS"}
              </p>
            )}
          </>
        )}
      </div>

      <div className="mt-2 px-1 pb-1 pt-8">
        <div
          ref={trackRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className={cn(
            "relative h-3.5 w-full touch-none rounded-full bg-surface-raised",
            disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer"
          )}
        >
          <div className="absolute inset-y-0 rounded-full bg-danger/35" style={lossZoneStyle} />
          <div className="absolute inset-y-0 rounded-full bg-accent-sc/90 shadow-glow-sc" style={winZoneStyle} />

          <div
            className="absolute top-1/2 z-10 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-text-primary shadow-md transition-[left] duration-100 ease-snappy"
            style={{ left: `${target}%` }}
          />

          {rollPct != null && (
            <div
              className={cn(
                "absolute top-1/2 z-20 h-5 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full transition-[left] duration-75",
                phase === "settled" ? (win ? "bg-success" : "bg-danger") : "bg-text-primary/70"
              )}
              style={{ left: `${rollPct}%` }}
            />
          )}
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-[10px] text-text-muted">
          <span>0</span>
          <span>25</span>
          <span>50</span>
          <span>75</span>
          <span>100</span>
        </div>
      </div>
    </div>
  );
}
