"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { BetAmountField } from "@/components/casino/originals/BetAmountField";
import { GameInfoSheet } from "@/components/casino/originals/GameInfoSheet";
import { GameLoading } from "@/components/casino/originals/GameLoading";
import { MinesGrid, type MinesTileState } from "@/components/casino/originals/MinesGrid";
import { RoundHistory } from "@/components/casino/originals/RoundHistory";
import { useMinesRound } from "@/lib/hooks/useMinesRound";
import { cn, formatCoins } from "@/lib/utils";

const GRID_SIZE = 25;
const BIG_WIN_MULTIPLIER = 5;

/** n choose k, safe for n,k <= 25 (well within double precision). */
function combination(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i++) {
    result = (result * (n - k + i)) / i;
  }
  return result;
}

/**
 * Display-only mirror of the backend's fair-multiplier formula
 * (backend/src/modules/casino/originals/mines/mines.outcome.ts's
 * computeMinesMultiplier) — used only for the pre-round "first safe pick
 * pays ~Nx" hint. Every multiplier actually shown once a round is live
 * comes straight from the /pick and /cashout responses.
 */
function estimateFirstPickMultiplier(minesCount: number, houseEdge: number): number {
  const fair = combination(GRID_SIZE, 1) / combination(GRID_SIZE - minesCount, 1);
  return Math.round(fair * (1 - houseEdge) * 10000) / 10000;
}

// Real casino Mines: choose a bet + mine count, start the round, then pick
// tiles one at a time. Each safe pick raises the live multiplier and the
// potential cash-out amount; a mine ends the round immediately and the
// bet is lost. Cash Out unlocks after the first safe pick and credits the
// current multiplier's payout on demand — this is what makes it Mines
// rather than a single "submit picks, resolve everything at once" bet.
// The server (see mines-round.service.ts) is authoritative for the mine
// layout, every pick's outcome, and the payout; this component only
// renders what the start/pick/cashout responses say.
export function MinesGame() {
  const {
    config,
    seed,
    onRotated,
    history,
    loadingConfig,
    loadingSeed,
    round,
    starting,
    pickingTile,
    cashingOut,
    lastError,
    startRound,
    pickTile,
    cashOut,
    resetRound,
  } = useMinesRound();

  const [betAmount, setBetAmount] = useState(100);
  const [mineCount, setMineCount] = useState(3);

  const firstPickEstimate = useMemo(
    () => estimateFirstPickMultiplier(mineCount, config?.houseEdge ?? 0),
    [mineCount, config?.houseEdge]
  );

  const tiles: MinesTileState[] = useMemo(() => {
    const arr: MinesTileState[] = Array(GRID_SIZE).fill("default");
    if (!round) return arr;

    round.picks.forEach((idx) => {
      arr[idx] = "safe";
    });

    if (round.phase === "busted" || round.phase === "cashed-out") {
      (round.minePositions ?? []).forEach((idx) => {
        arr[idx] = idx === round.hitTileIndex ? "mine-hit" : "mine";
      });
      for (let i = 0; i < GRID_SIZE; i++) {
        if (arr[i] === "default") arr[i] = "skipped";
      }
    } else if (pickingTile !== null) {
      arr[pickingTile] = "pending";
    }

    return arr;
  }, [round, pickingTile]);

  if (loadingConfig || !config) {
    return <GameLoading label="Mines" />;
  }

  const phase = round?.phase ?? "idle";
  const inSelect = phase === "idle";
  const inActive = phase === "active";
  const roundOver = phase === "busted" || phase === "cashed-out";
  const gridBusy = !inActive || pickingTile !== null || cashingOut;
  const canCashOut = inActive && (round?.picks.length ?? 0) > 0 && !cashingOut && pickingTile === null;
  const bigWin = phase === "cashed-out" && round!.currentMultiplier >= BIG_WIN_MULTIPLIER;

  async function handleStart() {
    await startRound({ betAmount, minesCount: mineCount });
  }

  return (
    // Same DOM-order + flex-row-reverse trick as Dice/Plinko: mobile
    // stacks the board first, lg:flex-row-reverse gives desktop a narrow
    // left control rail without shrinking the board's column.
    <div className="flex flex-col gap-5 lg:flex-row-reverse lg:items-start">
      <div className="flex-1">
        <div
          className={cn(
            "rounded-2xl bg-casino-ambient p-5 sm:p-6",
            bigWin && "animate-pulse-glow",
            phase === "busted" && "animate-shake"
          )}
        >
          {/* Live readout: current multiplier + potential win while a round is active. */}
          <div className="mb-4 flex items-center justify-center gap-6 rounded-xl border border-border/60 bg-surface/60 px-4 py-3">
            <div className="text-center">
              <p className="text-[10px] font-medium uppercase tracking-wide text-text-muted">Current multiplier</p>
              <p className="font-mono text-xl font-bold text-text-primary">
                {inActive || roundOver ? `${(round?.currentMultiplier ?? 0).toFixed(2)}x` : "1.00x"}
              </p>
            </div>
            <div className="h-8 w-px bg-border/60" />
            <div className="text-center">
              <p className="text-[10px] font-medium uppercase tracking-wide text-text-muted">Potential win</p>
              <p className="font-mono text-xl font-bold text-accent-sc">
                {inActive || roundOver
                  ? formatCoins((round?.potentialPayout ?? 0) * 100)
                  : formatCoins(betAmount)}
              </p>
            </div>
          </div>

          <MinesGrid tiles={tiles} onPick={pickTile} disabled={gridBusy} />

          <div className="mt-4 flex min-h-[28px] items-center justify-center">
            {phase === "busted" && (
              <p className="animate-win-enter text-sm font-bold text-danger">
                Boom — that was a mine. -{formatCoins((round?.betAmount ?? 0) * 100)}
              </p>
            )}
            {phase === "cashed-out" && (
              <p
                className={cn(
                  "animate-win-enter text-sm font-bold",
                  bigWin ? "text-accent-gc" : "text-success"
                )}
              >
                Cashed out · +{formatCoins((round?.finalPayout ?? 0) * 100)} · {(round?.currentMultiplier ?? 0).toFixed(2)}x
              </p>
            )}
            {inSelect && (
              <p className="text-xs text-text-muted">
                First safe pick pays ~<span className="font-mono font-semibold text-text-primary">{firstPickEstimate.toFixed(2)}x</span> at{" "}
                {mineCount} mine{mineCount > 1 ? "s" : ""}
              </p>
            )}
            {inActive && (round?.picks.length ?? 0) === 0 && (
              <p className="text-xs text-text-muted">Pick a tile — Cash Out unlocks after your first safe pick.</p>
            )}
          </div>
        </div>

        <div className="mt-3">
          <RoundHistory rounds={history} />
        </div>
      </div>

      <div className="space-y-4 lg:w-[260px] lg:shrink-0">
        <BetAmountField
          valueMinor={betAmount}
          onChange={setBetAmount}
          minMinor={config.minBet}
          maxMinor={config.maxBet}
          disabled={!inSelect}
        />

        <Select
          label="Mines"
          value={mineCount}
          disabled={!inSelect}
          onChange={(e) => setMineCount(parseInt(e.target.value, 10))}
        >
          {[1, 3, 5, 10, 15, 24].map((n) => (
            <option key={n} value={n}>
              {n} mine{n > 1 ? "s" : ""}
            </option>
          ))}
        </Select>

        {lastError && <p className="text-xs text-danger">{lastError}</p>}

        {inSelect && (
          <Button className="w-full" size="lg" variant="sc" onClick={handleStart} loading={starting}>
            Start game
          </Button>
        )}

        {inActive && (
          <Button className="w-full" size="lg" variant="sc" onClick={cashOut} loading={cashingOut} disabled={!canCashOut}>
            {canCashOut
              ? `Cash out · ${formatCoins((round?.potentialPayout ?? 0) * 100)}`
              : "Cash out (pick a tile first)"}
          </Button>
        )}

        {roundOver && (
          <Button className="w-full" size="lg" variant="secondary" onClick={resetRound}>
            New round
          </Button>
        )}

        <p className="text-xs text-text-muted">
          {inSelect
            ? `Pick tiles one at a time. Any mine ends the round — cash out whenever you like once you've cleared at least one tile.`
            : `${GRID_SIZE - mineCount - (round?.picks.length ?? 0)} safe tile${GRID_SIZE - mineCount - (round?.picks.length ?? 0) === 1 ? "" : "s"} left · ${mineCount} mine${mineCount > 1 ? "s" : ""} on the board.`}
        </p>

        <GameInfoSheet seed={seed} loading={loadingSeed} onRotated={onRotated} />
      </div>
    </div>
  );
}
