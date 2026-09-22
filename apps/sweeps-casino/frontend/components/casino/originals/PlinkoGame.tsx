"use client";

import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { BetAmountField } from "@/components/casino/originals/BetAmountField";
import { GameInfoSheet } from "@/components/casino/originals/GameInfoSheet";
import { GameLoading } from "@/components/casino/originals/GameLoading";
import { PlinkoBoard } from "@/components/casino/originals/PlinkoBoard";
import { RoundHistory } from "@/components/casino/originals/RoundHistory";
import { useOriginalGame } from "@/lib/hooks/useOriginalGame";
import { cn, formatCoins } from "@/lib/utils";

type Risk = "low" | "medium" | "high";

const BIG_WIN_MULTIPLIER = 5;

// Display-only mirror of the backend's getPlinkoMultiplierTable
// (backend/src/modules/casino/originals/plinko/plinko.outcome.ts). Used
// purely to label buckets before a drop — the credited multiplier always
// comes from the real /play response (lastResult.multiplier), never from
// this client-side table.
const RISK_FACTOR: Record<Risk, number> = { low: 1.5, medium: 3, high: 6 };

function displayMultiplierTable(rows: number, risk: Risk, houseEdge: number): number[] {
  const center = rows / 2;
  const riskFactor = RISK_FACTOR[risk];
  const table: number[] = [];
  for (let bucket = 0; bucket <= rows; bucket++) {
    const distance = center === 0 ? 0 : Math.abs(bucket - center) / center;
    const fair = 0.5 + distance * distance * riskFactor;
    table.push(Math.round(fair * (1 - houseEdge) * 10000) / 10000);
  }
  return table;
}

export function PlinkoGame() {
  const { config, seed, onRotated, history, loadingConfig, loadingSeed, playing, lastError, play } =
    useOriginalGame("plinko");

  const [betAmount, setBetAmount] = useState(100);
  const [rows, setRows] = useState(12);
  const [risk, setRisk] = useState<Risk>("medium");

  const [runId, setRunId] = useState(0);
  const [activePath, setActivePath] = useState<("L" | "R")[] | null>(null);
  const [activeBucket, setActiveBucket] = useState<number | null>(null);
  const [landed, setLanded] = useState(false);
  const [resultBanner, setResultBanner] = useState<{ win: boolean; multiplier: number; payoutMinor: number } | null>(
    null
  );
  const pendingRef = useRef(false);

  const multiplierTable = useMemo(
    () => displayMultiplierTable(rows, risk, config?.houseEdge ?? 0),
    [rows, risk, config?.houseEdge]
  );

  async function onDrop() {
    if (!config || playing || pendingRef.current) return;
    pendingRef.current = true;
    setLanded(false);
    setResultBanner(null);

    const result = await play({ betAmount, rows, risk: risk.toUpperCase() });
    if (!result) {
      pendingRef.current = false;
      return;
    }
    const path = (result.resultDetail.path as ("L" | "R")[]) ?? null;
    const bucket = typeof result.resultDetail.bucket === "number" ? (result.resultDetail.bucket as number) : null;
    setActivePath(path);
    setActiveBucket(bucket);
    setRunId((n) => n + 1);
    // Payout is revealed once PlinkoBoard's animation finishes (onLanded),
    // not immediately — see onBallLanded.
    setResultBanner({ win: result.win, multiplier: result.multiplier, payoutMinor: result.win ? result.payout * 100 : 0 });
  }

  function onBallLanded() {
    setLanded(true);
    pendingRef.current = false;
  }

  if (loadingConfig || !config) {
    return <GameLoading label="Plinko" />;
  }

  const busy = playing || pendingRef.current;
  const bigWin = !!resultBanner && landed && resultBanner.win && resultBanner.multiplier >= BIG_WIN_MULTIPLIER;

  return (
    // Same DOM-order + flex-row-reverse trick as Dice: mobile stacks the
    // board first (it must dominate the screen before any controls), and
    // lg:flex-row-reverse puts the (DOM-second) controls in a narrow left
    // rail on desktop without shrinking the board's column.
    <div className="flex flex-col gap-5 lg:flex-row-reverse lg:items-start">
      <div className="flex-1">
        <div className={cn("relative rounded-2xl", bigWin && "animate-pulse-glow")}>
          {/* PlinkoBoard also accepts optional onPegImpact / onLandImpact
              sound-effect hooks (scaffolding for a future audio pass — see
              PlinkoBoard.tsx). Left unset here since there's no audio
              system yet; they're safe no-ops until one exists. */}
          <PlinkoBoard
            rows={rows}
            multiplierTable={multiplierTable}
            path={activePath}
            bucket={activeBucket}
            runId={runId}
            onLanded={onBallLanded}
          />
          {landed && resultBanner && (
            <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
              <div
                className={cn(
                  "animate-win-enter rounded-full px-4 py-1.5 text-sm font-bold shadow-lg backdrop-blur",
                  resultBanner.win
                    ? bigWin
                      ? "bg-accent-gc/90 text-bg"
                      : "bg-success/90 text-bg"
                    : "bg-surface/90 text-danger"
                )}
              >
                {resultBanner.win ? `+${formatCoins(resultBanner.payoutMinor)} · ${resultBanner.multiplier.toFixed(2)}x` : "No win this drop"}
              </div>
            </div>
          )}
        </div>

        <div className="mt-3">
          <RoundHistory rounds={history} />
        </div>
      </div>

      <div className="space-y-4 lg:w-[240px] lg:shrink-0">
        <BetAmountField
          valueMinor={betAmount}
          onChange={setBetAmount}
          minMinor={config.minBet}
          maxMinor={config.maxBet}
          disabled={busy}
        />

        <Select label="Rows" value={rows} disabled={busy} onChange={(e) => setRows(parseInt(e.target.value, 10))}>
          {[8, 10, 12, 14, 16].map((n) => (
            <option key={n} value={n}>
              {n} rows
            </option>
          ))}
        </Select>

        <div className="grid grid-cols-3 gap-2">
          {(["low", "medium", "high"] as Risk[]).map((r) => (
            <Button
              key={r}
              type="button"
              variant={risk === r ? "sc" : "secondary"}
              onClick={() => setRisk(r)}
              disabled={busy}
              className="capitalize"
              size="sm"
            >
              {r}
            </Button>
          ))}
        </div>

        {lastError && <p className="text-xs text-danger">{lastError}</p>}

        <Button className="w-full" size="lg" variant="sc" onClick={onDrop} loading={busy}>
          Drop ball
        </Button>

        <GameInfoSheet seed={seed} loading={loadingSeed} onRotated={onRotated} />
      </div>
    </div>
  );
}
