"use client";

// The central Dice game board — a large target/result number as the focal
// point, a "ROLL OVER/UNDER" context line, and a 0-100 range track with a
// red/loss vs teal/win split at the target and a drag/tap-to-set handle.
// The parent animates the number by cycling through random values before
// settling exactly on the real roll (the backend resolves the round
// instantly — this is a pure presentation animation; the credited result
// never changes, and every number shown here — mid-cycle or settled — is
// `displayRoll` as handed down, never fabricated locally).
import { useEffect, useRef, useState } from "react";
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

// Small decorative particle burst for a win — purely presentational,
// derived deterministically (no Math.random at render time, so it can't
// cause an SSR/CSR hydration mismatch). bigWin gets a wider, denser burst.
function makeParticles(count: number, radius: number) {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 + (i % 2 === 0 ? 0.18 : -0.12);
    const dist = radius + (i % 3) * 10;
    return {
      dx: Math.round(Math.cos(angle) * dist),
      dy: Math.round(Math.sin(angle) * dist),
      delay: (i % 4) * 55,
      size: 4 + (i % 3) * 2,
      gold: i % 3 === 0,
    };
  });
}
const WIN_PARTICLES = makeParticles(8, 44);
const BIG_WIN_PARTICLES = makeParticles(14, 62);

const PAYOUT_TICK_MS = 520;

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

  // Bumped once each time a round settles, purely to key elements so their
  // CSS animations (pop, particle burst, payout count-up) replay on every
  // new result instead of silently no-op'ing when two wins land in a row.
  const [settleId, setSettleId] = useState(0);
  useEffect(() => {
    if (phase === "settled") setSettleId((n) => n + 1);
  }, [phase]);

  const [animatedPayout, setAnimatedPayout] = useState(0);
  useEffect(() => {
    if (phase !== "settled" || !win) {
      setAnimatedPayout(0);
      return;
    }
    const finalValue = payoutMinor ?? 0;
    const start = performance.now();
    let raf = 0;
    function frame(now: number) {
      const t = Math.min(1, (now - start) / PAYOUT_TICK_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimatedPayout(Math.round(finalValue * eased));
      if (t < 1) raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // settleId (not payoutMinor/win alone) is what should retrigger this —
    // a second win in a row can carry the same payout/win values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settleId]);

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

  const eyebrow =
    phase === "idle"
      ? "Set Your Target"
      : phase === "rolling"
        ? "Rolling…"
        : win
          ? bigWin
            ? "Big Win"
            : "Win"
          : "Loss";

  const bigNumberText =
    phase === "idle" ? target.toFixed(2) : displayRoll != null ? displayRoll.toFixed(2) : "--.--";

  const particles = bigWin ? BIG_WIN_PARTICLES : WIN_PARTICLES;

  return (
    <div className="select-none">
      <div className="relative flex min-h-[210px] flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl px-4 py-6 sm:min-h-[250px] sm:py-8">
        {/* Ambient glow field behind the number — always present at low
            opacity so the panel reads as composed, strengthens on a win. */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute left-1/2 top-1/2 h-48 w-48 -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl transition-opacity duration-300 sm:h-60 sm:w-60",
            phase === "settled" && win
              ? bigWin
                ? "bg-accent-gc/35 opacity-100"
                : "bg-success/25 opacity-100"
              : "bg-accent-sc/10 opacity-60"
          )}
        />

        {phase === "settled" && win && (
          <div key={`particles-${settleId}`} aria-hidden className="pointer-events-none absolute inset-0">
            {particles.map((p, i) => (
              <span
                key={i}
                className="dice-particle absolute left-1/2 top-1/2 rounded-full"
                style={
                  {
                    "--dx": `${p.dx}px`,
                    "--dy": `${p.dy}px`,
                    animationDelay: `${p.delay}ms`,
                    width: p.size,
                    height: p.size,
                    background: p.gold ? "rgb(var(--color-accent-gc))" : "rgb(var(--color-accent-sc))",
                  } as React.CSSProperties
                }
              />
            ))}
          </div>
        )}

        <p
          key={`eyebrow-${settleId}-${phase}`}
          className={cn(
            "relative animate-fade-in font-mono text-[11px] font-bold uppercase tracking-[0.2em]",
            phase === "settled" && win ? (bigWin ? "text-accent-gc" : "text-success") : undefined,
            phase === "settled" && win === false && "text-danger/90",
            phase !== "settled" && "text-text-muted"
          )}
        >
          {eyebrow}
        </p>

        <span
          key={phase === "rolling" ? `roll-${displayRoll}` : `num-${settleId}-${phase}`}
          className={cn(
            "relative font-mono text-6xl font-black tabular-nums leading-none sm:text-7xl lg:text-8xl",
            phase === "rolling" && "dice-roll-tick text-text-primary",
            phase === "idle" && "text-text-primary",
            phase === "settled" && win && "animate-pop text-success",
            phase === "settled" && win === false && "animate-fade-in text-danger"
          )}
          style={
            phase === "settled" && win
              ? {
                  textShadow: bigWin
                    ? "0 0 30px rgb(var(--color-accent-gc) / 0.8), 0 0 64px rgb(var(--color-accent-gc) / 0.4)"
                    : "0 0 24px rgb(var(--color-success) / 0.5)",
                }
              : undefined
          }
        >
          {bigNumberText}
        </span>

        <p
          key={`subline-${settleId}-${phase}`}
          className={cn(
            "relative animate-fade-in font-mono text-sm font-semibold sm:text-base",
            phase === "settled" && win
              ? cn("text-lg font-bold sm:text-xl", bigWin ? "text-accent-gc" : "text-success")
              : "text-text-muted"
          )}
        >
          {phase === "settled" && win
            ? `+${formatCoins(animatedPayout)}`
            : `ROLL ${direction.toUpperCase()} ${target.toFixed(2)}`}
        </p>
      </div>

      <div className="mt-2 px-1 pb-1 pt-6">
        <div
          ref={trackRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className={cn(
            "relative h-4 w-full touch-none rounded-full bg-surface-raised sm:h-5",
            disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer"
          )}
        >
          <div className="absolute inset-y-0 rounded-full bg-danger/35" style={lossZoneStyle} />
          <div
            className={cn(
              "absolute inset-y-0 rounded-full bg-accent-sc/90 shadow-glow-sc",
              phase !== "settled" && "dice-zone-pulse"
            )}
            style={winZoneStyle}
          />

          <div
            className="absolute top-1/2 z-10 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-text-primary shadow-[0_0_14px_3px_rgb(var(--color-text-primary)/0.45)] transition-[left] duration-100 ease-snappy sm:h-8 sm:w-8"
            style={{ left: `${target}%` }}
          />

          {rollPct != null && (
            <div
              className={cn(
                "absolute top-1/2 z-20 h-6 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full transition-[left] duration-75 sm:h-7",
                phase === "settled"
                  ? win
                    ? "bg-success shadow-[0_0_10px_2px_rgb(var(--color-success)/0.6)]"
                    : "bg-danger"
                  : "bg-text-primary/80"
              )}
              style={{ left: `${rollPct}%` }}
            />
          )}
        </div>
        <div className="mt-1.5 flex justify-between">
          {["0", "25", "50", "75", "100"].map((label) => (
            <div key={label} className="flex flex-col items-center gap-1">
              <span className="h-1.5 w-px bg-text-muted/40" />
              <span className="font-mono text-[10px] font-medium text-text-muted/90">{label}</span>
            </div>
          ))}
        </div>
      </div>

      <style jsx>{`
        .dice-roll-tick {
          animation: dice-roll-tick 140ms ease-out;
        }
        @keyframes dice-roll-tick {
          0% {
            opacity: 0.6;
            transform: translateY(-5px) scale(0.95);
            filter: blur(2px);
          }
          55% {
            opacity: 1;
            transform: translateY(1px) scale(1.03);
            filter: blur(0.3px);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: blur(0);
          }
        }
        .dice-zone-pulse {
          animation: dice-zone-pulse 2.2s ease-in-out infinite;
        }
        @keyframes dice-zone-pulse {
          0%,
          100% {
            box-shadow: 0 0 10px 0 rgb(var(--color-accent-sc) / 0.35);
          }
          50% {
            box-shadow: 0 0 20px 4px rgb(var(--color-accent-sc) / 0.6);
          }
        }
        .dice-particle {
          opacity: 0;
          animation: dice-particle-burst 900ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        @keyframes dice-particle-burst {
          0% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.4);
          }
          15% {
            opacity: 1;
          }
          100% {
            opacity: 0;
            transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(1);
          }
        }
      `}</style>
    </div>
  );
}
