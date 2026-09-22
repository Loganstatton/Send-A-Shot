"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { BetAmountField } from "@/components/casino/originals/BetAmountField";
import { DiceRangeVisual } from "@/components/casino/originals/DiceRangeVisual";
import { GameInfoSheet } from "@/components/casino/originals/GameInfoSheet";
import { GameLoading } from "@/components/casino/originals/GameLoading";
import { RoundHistory } from "@/components/casino/originals/RoundHistory";
import { useOriginalGame } from "@/lib/hooks/useOriginalGame";
import { cn } from "@/lib/utils";

type Phase = "idle" | "rolling" | "settled";

// Multiplier at/above this reads as a "big win" and gets the celebratory
// gold treatment instead of the default success-green flash — the backend
// has no notion of "big win", this is purely a presentation threshold.
const BIG_WIN_MULTIPLIER = 5;
const CYCLE_DURATION_MS = 750;

export function DiceGame() {
  const { config, seed, onRotated, history, loadingConfig, loadingSeed, playing, lastError, lastResult, play } =
    useOriginalGame("dice");

  const [betAmount, setBetAmount] = useState(100);
  const [target, setTarget] = useState(50);
  const [direction, setDirection] = useState<"over" | "under">("over");

  const [phase, setPhase] = useState<Phase>("idle");
  const [displayRoll, setDisplayRoll] = useState<number | null>(null);
  const [win, setWin] = useState<boolean | null>(null);
  const [payoutMinor, setPayoutMinor] = useState<number | null>(null);
  const [bigWin, setBigWin] = useState(false);
  const animatingRef = useRef(false);

  const winChance = direction === "over" ? 100 - target : target;
  const multiplier = winChance > 0 ? (99 / winChance).toFixed(4) : "0";

  const runCycle = useCallback((final: number) => {
    return new Promise<void>((resolve) => {
      animatingRef.current = true;
      const start = performance.now();
      let lastTick = 0;
      function frame(now: number) {
        const elapsed = now - start;
        if (elapsed >= CYCLE_DURATION_MS) {
          setDisplayRoll(final);
          animatingRef.current = false;
          resolve();
          return;
        }
        // Throttle visual updates to ~18/sec so it reads as a rolling
        // number rather than an unreadable blur.
        if (now - lastTick > 55) {
          setDisplayRoll(Math.random() * 100);
          lastTick = now;
        }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  }, []);

  async function onRoll() {
    if (!config || playing || animatingRef.current) return;
    setPhase("rolling");
    setWin(null);
    setPayoutMinor(null);
    setBigWin(false);

    const result = await play({ betAmount, target, direction: direction.toUpperCase() });
    if (!result) {
      setPhase("idle");
      return;
    }

    const finalRoll = typeof result.resultDetail.roll === "number" ? (result.resultDetail.roll as number) : 0;
    await runCycle(finalRoll);

    setWin(result.win);
    // result.payout is a plain dollar decimal (see useOriginalGame's
    // fromPlayResponse), so *100 to get back to the minor-unit convention
    // formatCoins() and BetAmountField expect.
    setPayoutMinor(result.win ? result.payout * 100 : 0);
    setBigWin(result.win && result.multiplier >= BIG_WIN_MULTIPLIER);
    setPhase("settled");
  }

  if (loadingConfig || !config) {
    return <GameLoading label="Dice" />;
  }

  const busy = playing || animatingRef.current;

  return (
    // flex-col (mobile) stacks in DOM order — board first, controls below.
    // lg:flex-row-reverse visually reverses that on desktop without
    // touching DOM order, so controls end up narrow-left and the board
    // large-right (CSS Grid + `order` would instead move the *board* into
    // the narrow track, since grid auto-placement follows order-modified
    // document order — flex avoids that trap).
    <div className="flex flex-col gap-6 lg:flex-row-reverse lg:items-start">
      <div
        className={cn(
          "flex-1 rounded-2xl bg-casino-ambient p-5 sm:p-6 lg:flex lg:min-h-[560px] lg:flex-col lg:justify-center",
          bigWin && phase === "settled" && "animate-pulse-glow"
        )}
      >
        <DiceRangeVisual
          target={target}
          direction={direction}
          onTargetChange={setTarget}
          disabled={busy}
          displayRoll={displayRoll}
          phase={phase}
          win={win}
          payoutMinor={payoutMinor}
          bigWin={bigWin}
        />
      </div>

      <div className="space-y-4 lg:w-[300px] lg:shrink-0">
        <BetAmountField
          valueMinor={betAmount}
          onChange={setBetAmount}
          minMinor={config.minBet}
          maxMinor={config.maxBet}
          disabled={busy}
        />

        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={direction === "under" ? "sc" : "secondary"}
            onClick={() => setDirection("under")}
            disabled={busy}
          >
            Roll Under
          </Button>
          <Button
            type="button"
            variant={direction === "over" ? "sc" : "secondary"}
            onClick={() => setDirection("over")}
            disabled={busy}
          >
            Roll Over
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3 rounded-xl bg-surface-raised p-3 text-center text-xs">
          <div>
            <p className="text-text-muted">Win chance</p>
            <p className="font-mono font-semibold text-text-primary">{winChance.toFixed(2)}%</p>
          </div>
          <div>
            <p className="text-text-muted">Multiplier</p>
            <p className="font-mono font-semibold text-text-primary">{multiplier}x</p>
          </div>
        </div>

        {lastError && <p className="text-xs text-danger">{lastError}</p>}

        <Button className="w-full" size="lg" variant="sc" onClick={onRoll} loading={busy}>
          Roll dice
        </Button>

        <RoundHistory rounds={history} />
        <GameInfoSheet seed={seed} loading={loadingSeed} onRotated={onRotated} />
      </div>
    </div>
  );
}
