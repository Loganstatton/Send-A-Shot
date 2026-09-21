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

// The backend settles a Mines round as a single shot: all tile picks are
// submitted together and the round resolves immediately (see
// backend/src/modules/casino/originals/mines/mines.outcome.ts) rather than
// an interactive reveal-with-mid-round-cashout flow. So this UI is
// "select your tiles, then reveal" — clicking a tile only toggles a local
// selection until Reveal submits the whole pick set in one /play call.
export function MinesGame() {
  const { config, seed, onRotated, history, loadingConfig, loadingSeed, playing, lastError, lastResult, play } =
    useOriginalGame("mines");

  const [betAmount, setBetAmount] = useState(100);
  const [mineCount, setMineCount] = useState(3);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [revealedMines, setRevealedMines] = useState<number[]>([]);
  const [hitMine, setHitMine] = useState(false);
  const [settled, setSettled] = useState(false);

  function toggleTile(idx: number) {
    if (settled || playing) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function newRound() {
    setSelected(new Set());
    setRevealedMines([]);
    setHitMine(false);
    setSettled(false);
  }

  async function reveal() {
    if (selected.size === 0) return;
    const result = await play({ betAmount, minesCount: mineCount, picks: Array.from(selected) });
    if (!result) return;
    const mines = (result.resultDetail.minePositions as number[]) || [];
    setRevealedMines(mines);
    setHitMine(result.resultDetail.hitMine === true);
    setSettled(true);
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
            disabled={playing || settled}
          />

          <Select
            label="Mines"
            value={mineCount}
            disabled={playing || settled}
            onChange={(e) => setMineCount(parseInt(e.target.value, 10))}
          >
            {[1, 3, 5, 10, 15, 24].map((n) => (
              <option key={n} value={n}>
                {n} mine{n > 1 ? "s" : ""}
              </option>
            ))}
          </Select>

          <p className="text-xs text-text-muted">
            Pick up to {GRID_SIZE - mineCount} tiles, then reveal. Any mine among your picks busts the whole bet.
          </p>

          {lastError && <p className="text-xs text-danger">{lastError}</p>}

          {!settled ? (
            <Button className="w-full" size="lg" onClick={reveal} loading={playing} disabled={selected.size === 0}>
              Reveal ({selected.size} picked)
            </Button>
          ) : (
            <Button className="w-full" size="lg" variant="secondary" onClick={newRound}>
              New round
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="space-y-5">
        <Card>
          <CardContent className="p-5">
            <div className="mx-auto grid max-w-md grid-cols-5 gap-2">
              {Array.from({ length: GRID_SIZE }).map((_, idx) => {
                const isSelected = selected.has(idx);
                const isMine = revealedMines.includes(idx);
                const showMine = settled && isMine;
                const showSafePick = settled && isSelected && !isMine;
                return (
                  <button
                    key={idx}
                    onClick={() => toggleTile(idx)}
                    disabled={settled || playing}
                    className={cn(
                      "flex aspect-square items-center justify-center rounded-lg border text-lg transition-all",
                      showSafePick && "border-success/40 bg-success/15",
                      showMine && "border-danger/50 bg-danger/20",
                      !settled && isSelected && "border-accent-sc bg-accent-sc/15",
                      !settled && !isSelected && "border-border bg-surface-raised hover:border-accent-sc/50",
                      (settled || playing) && "cursor-not-allowed"
                    )}
                  >
                    {showSafePick && <StarFilled className="h-4 w-4 text-accent-gc" />}
                    {showMine && <Bomb className="h-4 w-4 text-danger" />}
                  </button>
                );
              })}
            </div>
            {settled && hitMine && (
              <p className="mt-4 text-center text-sm font-semibold text-danger">Boom — round over.</p>
            )}
            {settled && !hitMine && lastResult && (
              <p className="mt-4 text-center text-sm font-semibold text-success">
                Cleared · {lastResult.multiplier.toFixed(2)}x
              </p>
            )}
          </CardContent>
        </Card>

        <ProvablyFairPanel seed={seed} loading={loadingSeed} onRotated={onRotated} />
        <RoundHistory rounds={history} />
      </div>
    </div>
  );
}
