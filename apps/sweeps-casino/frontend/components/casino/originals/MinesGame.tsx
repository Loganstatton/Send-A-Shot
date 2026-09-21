"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { BetAmountField } from "@/components/casino/originals/BetAmountField";
import { ProvablyFairPanel } from "@/components/casino/originals/ProvablyFairPanel";
import { RoundHistory } from "@/components/casino/originals/RoundHistory";
import { useOriginalGame } from "@/lib/hooks/useOriginalGame";
import { Bomb, StarFilled } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

const GRID_SIZE = 25;

export function MinesGame() {
  const { config, seed, setSeed, history, loadingConfig, loadingSeed, playing, lastError, lastResult, play } =
    useOriginalGame("mines");

  const [betAmount, setBetAmount] = useState(100);
  const [mineCount, setMineCount] = useState(3);
  const [roundActive, setRoundActive] = useState(false);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [busted, setBusted] = useState(false);
  const [minePositions, setMinePositions] = useState<number[]>([]);

  function reset() {
    setRoundActive(false);
    setRevealed(new Set());
    setBusted(false);
    setMinePositions([]);
  }

  async function startRound() {
    reset();
    setRoundActive(true);
  }

  async function cashOut() {
    const result = await play({ betAmount, mineCount, action: "cashout", revealed: Array.from(revealed) });
    if (result) {
      const mines = (result.resultDetail.minePositions as number[]) || [];
      setMinePositions(mines);
    }
    setRoundActive(false);
  }

  async function revealTile(idx: number) {
    if (!roundActive || revealed.has(idx) || playing) return;
    const result = await play({ betAmount, mineCount, action: "reveal", tile: idx, revealed: Array.from(revealed) });
    if (!result) return;
    const nextRevealed = new Set(revealed);
    nextRevealed.add(idx);
    setRevealed(nextRevealed);

    const hitMine = result.resultDetail.hitMine === true;
    if (hitMine) {
      setBusted(true);
      setRoundActive(false);
      const mines = (result.resultDetail.minePositions as number[]) || [idx];
      setMinePositions(mines);
    }
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
            disabled={playing || roundActive}
          />

          <Select
            label="Mines"
            value={mineCount}
            disabled={playing || roundActive}
            onChange={(e) => setMineCount(parseInt(e.target.value, 10))}
          >
            {[1, 3, 5, 10, 15, 24].map((n) => (
              <option key={n} value={n}>
                {n} mine{n > 1 ? "s" : ""}
              </option>
            ))}
          </Select>

          {lastError && <p className="text-xs text-danger">{lastError}</p>}

          {!roundActive ? (
            <Button className="w-full" size="lg" onClick={startRound} loading={playing}>
              Start round
            </Button>
          ) : (
            <Button className="w-full" size="lg" variant="primary" onClick={cashOut} loading={playing}>
              Cash out
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="space-y-5">
        <Card>
          <CardContent className="p-5">
            <div className="mx-auto grid max-w-md grid-cols-5 gap-2">
              {Array.from({ length: GRID_SIZE }).map((_, idx) => {
                const isRevealed = revealed.has(idx);
                const isMine = minePositions.includes(idx);
                const showMine = !roundActive && isMine;
                return (
                  <button
                    key={idx}
                    onClick={() => revealTile(idx)}
                    disabled={!roundActive || isRevealed || playing}
                    className={cn(
                      "flex aspect-square items-center justify-center rounded-lg border text-lg transition-all",
                      isRevealed && !showMine && "border-success/40 bg-success/15",
                      showMine && "border-danger/50 bg-danger/20",
                      !isRevealed && !showMine && "border-border bg-surface-raised hover:border-accent-sc/50",
                      (!roundActive || playing) && !isRevealed && "cursor-not-allowed opacity-70"
                    )}
                  >
                    {isRevealed && !showMine && <StarFilled className="h-4 w-4 text-accent-gc" />}
                    {showMine && <Bomb className="h-4 w-4 text-danger" />}
                  </button>
                );
              })}
            </div>
            {busted && <p className="mt-4 text-center text-sm font-semibold text-danger">Boom — round over.</p>}
            {lastResult?.win && !roundActive && (
              <p className="mt-4 text-center text-sm font-semibold text-success">
                Cashed out · {lastResult.multiplier.toFixed(2)}x
              </p>
            )}
          </CardContent>
        </Card>

        <ProvablyFairPanel seed={seed} loading={loadingSeed} onRotated={setSeed} />
        <RoundHistory rounds={history} />
      </div>
    </div>
  );
}
