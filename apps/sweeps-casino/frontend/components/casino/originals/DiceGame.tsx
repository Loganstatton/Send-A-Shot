"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { BetAmountField } from "@/components/casino/originals/BetAmountField";
import { ProvablyFairPanel } from "@/components/casino/originals/ProvablyFairPanel";
import { RoundHistory } from "@/components/casino/originals/RoundHistory";
import { useOriginalGame } from "@/lib/hooks/useOriginalGame";
import { cn } from "@/lib/utils";

export function DiceGame() {
  const { config, seed, onRotated, history, loadingConfig, loadingSeed, playing, lastError, lastResult, play } =
    useOriginalGame("dice");

  const [betAmount, setBetAmount] = useState(100);
  const [target, setTarget] = useState(50);
  const [direction, setDirection] = useState<"over" | "under">("over");

  const winChance = direction === "over" ? 100 - target : target;
  const multiplier = winChance > 0 ? (99 / winChance).toFixed(4) : "0";

  async function onRoll() {
    if (!config) return;
    await play({ betAmount, target, direction: direction.toUpperCase() });
  }

  if (loadingConfig || !config) {
    return <Skeleton className="h-96 w-full rounded-xl" />;
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[340px_1fr]">
      <Card>
        <CardContent className="space-y-4 p-5">
          <BetAmountField
            valueMinor={betAmount}
            onChange={setBetAmount}
            minMinor={config.minBet}
            maxMinor={config.maxBet}
            disabled={playing}
          />

          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="font-medium text-text-muted">Roll {direction}</span>
              <span className="font-mono text-text-primary">{target.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={2}
              max={98}
              step={0.01}
              value={target}
              disabled={playing}
              onChange={(e) => setTarget(parseFloat(e.target.value))}
              className="w-full accent-accent-sc"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={direction === "under" ? "sc" : "secondary"}
              onClick={() => setDirection("under")}
              disabled={playing}
            >
              Roll Under
            </Button>
            <Button
              type="button"
              variant={direction === "over" ? "sc" : "secondary"}
              onClick={() => setDirection("over")}
              disabled={playing}
            >
              Roll Over
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-lg bg-surface-raised p-3 text-center text-xs">
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

          <Button className="w-full" size="lg" onClick={onRoll} loading={playing}>
            Roll dice
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-5">
        <Card>
          <CardContent className="flex min-h-[180px] flex-col items-center justify-center p-6">
            {!lastResult ? (
              <p className="text-sm text-text-muted">Place a bet to roll.</p>
            ) : (
              <div className="text-center">
                <p
                  className={cn(
                    "font-mono text-5xl font-extrabold",
                    lastResult.win ? "text-success" : "text-danger"
                  )}
                >
                  {typeof lastResult.resultDetail.roll === "number"
                    ? (lastResult.resultDetail.roll as number).toFixed(2)
                    : "—"}
                </p>
                <p className={cn("mt-2 text-sm font-semibold", lastResult.win ? "text-success" : "text-danger")}>
                  {lastResult.win ? `Win · ${lastResult.multiplier.toFixed(2)}x` : "Loss"}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <ProvablyFairPanel seed={seed} loading={loadingSeed} onRotated={onRotated} />
        <RoundHistory rounds={history} />
      </div>
    </div>
  );
}
