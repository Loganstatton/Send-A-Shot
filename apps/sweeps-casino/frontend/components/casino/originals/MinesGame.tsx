"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { BetAmountField } from "@/components/casino/originals/BetAmountField";
import { GameInfoSheet } from "@/components/casino/originals/GameInfoSheet";
import { GameLoading } from "@/components/casino/originals/GameLoading";
import { MinesGrid, type MinesTileState } from "@/components/casino/originals/MinesGrid";
import { RoundHistory } from "@/components/casino/originals/RoundHistory";
import { useOriginalGame } from "@/lib/hooks/useOriginalGame";
import { cn, formatCoins } from "@/lib/utils";

const GRID_SIZE = 25;
const BIG_WIN_MULTIPLIER = 5;
const REVEAL_STEP_MS_MIN = 160;
const REVEAL_STEP_MS_JITTER = 90;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

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
 * Display-only mirror of the backend's fair-multiplier formula for Mines
 * (backend/src/modules/casino/originals/mines/mines.outcome.ts) — used to
 * show a live "potential payout" estimate while picking tiles. The
 * credited multiplier always comes from the real /play response.
 */
function estimateMultiplier(picks: number, minesCount: number, houseEdge: number): number {
  if (picks === 0) return 0;
  const fair = combination(GRID_SIZE, picks) / combination(GRID_SIZE - minesCount, picks);
  return Math.round(fair * (1 - houseEdge) * 10000) / 10000;
}

type Phase = "select" | "revealing" | "done";

// The backend settles a Mines round as a single shot: all tile picks are
// submitted together and the round resolves immediately (see
// backend/src/modules/casino/originals/mines/mines.outcome.ts) rather than
// an interactive reveal-with-mid-round-cashout flow. So this UI lets the
// player select tiles, then "Reveal" submits the whole pick set in one
// /play call — afterward, picks are stagger-revealed client-side (in the
// order they were picked) to simulate an interactive feel, stopping the
// instant a mine is uncovered. There is no real mid-round cashout, so
// "Reveal" (not "Cash out") is always the real action.
export function MinesGame() {
  const { config, seed, onRotated, history, loadingConfig, loadingSeed, playing, lastError, play } =
    useOriginalGame("mines");

  const [betAmount, setBetAmount] = useState(100);
  const [mineCount, setMineCount] = useState(3);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const [phase, setPhase] = useState<Phase>("select");
  const [pickOrder, setPickOrder] = useState<number[]>([]);
  const [revealedCount, setRevealedCount] = useState(0);
  const [minePositions, setMinePositions] = useState<number[]>([]);
  const [hitMine, setHitMine] = useState(false);
  const [stoppedEarly, setStoppedEarly] = useState(false);
  const [outcome, setOutcome] = useState<{ win: boolean; multiplier: number; payoutMinor: number } | null>(null);

  const potentialMultiplier = useMemo(
    () => estimateMultiplier(selected.size, mineCount, config?.houseEdge ?? 0),
    [selected.size, mineCount, config?.houseEdge]
  );

  const tiles: MinesTileState[] = useMemo(() => {
    const arr: MinesTileState[] = Array(GRID_SIZE).fill("default");
    if (phase === "select") {
      selected.forEach((i) => (arr[i] = "selected"));
      return arr;
    }
    pickOrder.forEach((idx, i) => {
      if (i < revealedCount) {
        arr[idx] = minePositions.includes(idx) ? "mine" : "safe";
      } else {
        arr[idx] = stoppedEarly ? "skipped" : "selected";
      }
    });
    return arr;
  }, [phase, selected, pickOrder, revealedCount, minePositions, stoppedEarly]);

  function toggleTile(idx: number) {
    if (phase !== "select" || playing) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else if (next.size < GRID_SIZE - mineCount) next.add(idx);
      return next;
    });
  }

  function newRound() {
    setSelected(new Set());
    setPickOrder([]);
    setRevealedCount(0);
    setMinePositions([]);
    setHitMine(false);
    setStoppedEarly(false);
    setOutcome(null);
    setPhase("select");
  }

  async function reveal() {
    if (selected.size === 0 || phase !== "select") return;
    const picks = Array.from(selected); // Set preserves insertion order == click order
    setPickOrder(picks);
    setRevealedCount(0);
    setStoppedEarly(false);
    setMinePositions([]);
    setOutcome(null);
    setPhase("revealing");

    const result = await play({ betAmount, minesCount: mineCount, picks });
    if (!result) {
      setPhase("select");
      return;
    }
    const mines = (result.resultDetail.minePositions as number[]) || [];
    const hit = result.resultDetail.hitMine === true;
    setMinePositions(mines);
    setHitMine(hit);

    for (let i = 0; i < picks.length; i++) {
      await sleep(REVEAL_STEP_MS_MIN + Math.random() * REVEAL_STEP_MS_JITTER);
      setRevealedCount(i + 1);
      if (hit && mines.includes(picks[i])) {
        setStoppedEarly(true);
        break;
      }
    }

    // result.payout is a plain dollar decimal (see useOriginalGame's
    // fromPlayResponse), so *100 to get back to the minor-unit convention
    // formatCoins() and BetAmountField expect.
    setOutcome({ win: result.win, multiplier: result.multiplier, payoutMinor: result.win ? result.payout * 100 : 0 });
    setPhase("done");
  }

  if (loadingConfig || !config) {
    return <GameLoading label="Mines" />;
  }

  const busy = playing || phase === "revealing";
  const bigWin = phase === "done" && !!outcome?.win && outcome.multiplier >= BIG_WIN_MULTIPLIER;

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
            phase === "done" && hitMine && "animate-shake"
          )}
        >
          <MinesGrid tiles={tiles} onToggle={toggleTile} disabled={busy} />

          <div className="mt-4 flex min-h-[28px] items-center justify-center">
            {phase === "done" && hitMine && (
              <p className="animate-win-enter text-sm font-bold text-danger">Boom — a mine was among your picks.</p>
            )}
            {phase === "done" && !hitMine && outcome && (
              <p
                className={cn(
                  "animate-win-enter text-sm font-bold",
                  bigWin ? "text-accent-gc" : "text-success"
                )}
              >
                Cleared · +{formatCoins(outcome.payoutMinor)} · {outcome.multiplier.toFixed(2)}x
              </p>
            )}
            {phase === "select" && selected.size > 0 && (
              <p className="text-xs text-text-muted">
                Potential payout at {selected.size} pick{selected.size > 1 ? "s" : ""}:{" "}
                <span className="font-mono font-semibold text-text-primary">{potentialMultiplier.toFixed(2)}x</span>
              </p>
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
          disabled={playing || phase !== "select"}
        />

        <Select
          label="Mines"
          value={mineCount}
          disabled={playing || phase !== "select"}
          onChange={(e) => {
            const next = parseInt(e.target.value, 10);
            setMineCount(next);
            setSelected((prev) => {
              const capped = new Set(Array.from(prev).slice(0, GRID_SIZE - next));
              return capped;
            });
          }}
        >
          {[1, 3, 5, 10, 15, 24].map((n) => (
            <option key={n} value={n}>
              {n} mine{n > 1 ? "s" : ""}
            </option>
          ))}
        </Select>

        <p className="text-xs text-text-muted">
          Pick up to {GRID_SIZE - mineCount} tiles, then reveal. Any mine among your picks busts the whole bet — there's
          no mid-round cash-out, Reveal settles the round.
        </p>

        {lastError && <p className="text-xs text-danger">{lastError}</p>}

        {phase !== "done" ? (
          <Button className="w-full" size="lg" variant="sc" onClick={reveal} loading={busy} disabled={selected.size === 0}>
            Reveal ({selected.size} picked)
          </Button>
        ) : (
          <Button className="w-full" size="lg" variant="secondary" onClick={newRound}>
            New round
          </Button>
        )}

        <GameInfoSheet seed={seed} loading={loadingSeed} onRotated={onRotated} />
      </div>
    </div>
  );
}
