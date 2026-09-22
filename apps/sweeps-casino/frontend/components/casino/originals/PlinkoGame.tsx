"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { BetAmountField } from "@/components/casino/originals/BetAmountField";
import { GameInfoSheet } from "@/components/casino/originals/GameInfoSheet";
import { GameLoading } from "@/components/casino/originals/GameLoading";
import { PlinkoBoard, type PlinkoDropRequest } from "@/components/casino/originals/PlinkoBoard";
import { RoundHistory } from "@/components/casino/originals/RoundHistory";
import { plinkoAudio } from "@/components/casino/originals/plinkoAudio";
import { useOriginalGame } from "@/lib/hooks/useOriginalGame";
import { cn, formatCoins } from "@/lib/utils";

type Risk = "low" | "medium" | "high";

const BIG_WIN_MULTIPLIER = 5;
// How many balls can be genuinely in flight (dropped, server-confirmed,
// still animating) at once. Real, independent concurrency underneath —
// this cap exists purely to keep the board and the banner stack readable
// on a phone screen, not because the physics/backend can't handle more.
const MAX_CONCURRENT_BALLS = 4;
// How long a landed round's result banner stays in the stack before it
// auto-dismisses.
const BANNER_LIFETIME_MS = 2600;
// Bound how much round bookkeeping this component holds on to across a
// long session — the board itself independently tracks/garbage-collects
// its own rendered balls, so trimming this just keeps our own arrays small.
const MAX_TRACKED_BALLS = 30;

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

interface ActiveBall {
  id: string;
  bucket: number;
  multiplier: number;
  win: boolean;
  payoutMinor: number;
  landed: boolean;
}

interface Banner {
  id: string;
  win: boolean;
  bigWin: boolean;
  multiplier: number;
  payoutMinor: number;
}

export function PlinkoGame() {
  const { config, seed, onRotated, history, loadingConfig, loadingSeed, lastError, play } = useOriginalGame("plinko");

  const [betAmount, setBetAmount] = useState(100);
  const [rows, setRows] = useState(12);
  const [risk, setRisk] = useState<Risk>("medium");
  const [posting, setPosting] = useState(false);

  const [activeBalls, setActiveBalls] = useState<ActiveBall[]>([]);
  const activeBallsRef = useRef<ActiveBall[]>([]);
  activeBallsRef.current = activeBalls;
  const [banners, setBanners] = useState<Banner[]>([]);
  const bannerTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const timers = bannerTimersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const multiplierTable = useMemo(
    () => displayMultiplierTable(rows, risk, config?.houseEdge ?? 0),
    [rows, risk, config?.houseEdge]
  );

  const inFlightCount = activeBalls.filter((b) => !b.landed).length;
  const anyInFlight = inFlightCount > 0;

  async function onDrop() {
    if (!config || posting) return;
    if (activeBallsRef.current.filter((b) => !b.landed).length >= MAX_CONCURRENT_BALLS) return;
    // Real user gesture (this click) — the only place audio is allowed to start.
    plinkoAudio.ensureStarted();
    setPosting(true);
    try {
      const result = await play({ betAmount, rows, risk: risk.toUpperCase() });
      if (!result) return;
      const bucket = typeof result.resultDetail.bucket === "number" ? (result.resultDetail.bucket as number) : null;
      if (bucket == null) return;
      const ball: ActiveBall = {
        id: result.roundId,
        bucket,
        multiplier: result.multiplier,
        win: result.win,
        payoutMinor: result.win ? result.payout * 100 : 0,
        landed: false,
      };
      setActiveBalls((prev) => [...prev.slice(-MAX_TRACKED_BALLS), ball]);
    } finally {
      setPosting(false);
    }
  }

  const onBallLanded = useCallback((id: string) => {
    // activeBallsRef mirrors state as of the last render, which already
    // includes this ball (added many renders ago, when the drop was
    // placed) — no need to thread data through the setState updater.
    const b = activeBallsRef.current.find((x) => x.id === id);
    setActiveBalls((prev) => prev.map((x) => (x.id === id ? { ...x, landed: true } : x)));
    if (!b) return;
    const bigWin = b.win && b.multiplier >= BIG_WIN_MULTIPLIER;
    setBanners((prev) => [...prev, { id: b.id, win: b.win, bigWin, multiplier: b.multiplier, payoutMinor: b.payoutMinor }]);
    const timer = setTimeout(() => {
      bannerTimersRef.current.delete(b.id);
      setBanners((prev) => prev.filter((x) => x.id !== b.id));
    }, BANNER_LIFETIME_MS);
    bannerTimersRef.current.set(b.id, timer);
  }, []);

  const drops: PlinkoDropRequest[] = useMemo(() => activeBalls.map((b) => ({ id: b.id, bucket: b.bucket })), [activeBalls]);

  if (loadingConfig || !config) {
    return <GameLoading label="Plinko" />;
  }

  const anyBigWinBanner = banners.some((b) => b.bigWin);
  const dropDisabled = posting || inFlightCount >= MAX_CONCURRENT_BALLS;

  return (
    // Same DOM-order + flex-row-reverse trick as Dice: mobile stacks the
    // board first (it must dominate the screen before any controls), and
    // lg:flex-row-reverse puts the (DOM-second) controls in a narrow left
    // rail on desktop without shrinking the board's column.
    <div className="flex flex-col gap-4 lg:flex-row-reverse lg:items-start lg:gap-5">
      {/* min-w-0 overrides the flexbox default (a flex item won't shrink
          below its content's intrinsic min-width, e.g. RoundHistory's
          horizontal strip) — without it this column refuses to shrink on
          desktop and pushes the controls rail off-screen. */}
      <div className="min-w-0 flex-1">
        {/* -mx-3 cancels the game page's own edge padding on mobile so the
            board itself runs almost full viewport width, per the product
            spec ("the board should occupy almost the entire available
            mobile width") — restored at sm+ where that padding is welcome. */}
        <div className={cn("relative -mx-3 sm:mx-0 sm:rounded-2xl", anyBigWinBanner && "animate-pulse-glow")}>
          <PlinkoBoard
            rows={rows}
            multiplierTable={multiplierTable}
            drops={drops}
            onLanded={onBallLanded}
            bigWinMultiplier={BIG_WIN_MULTIPLIER}
          />

          {/* Stacked result banners — one per recently-landed ball. Several
              balls landing close together (the whole point of concurrent
              drops) queue as a short vertical stack rather than overwriting
              each other. */}
          {banners.length > 0 && (
            <div className="pointer-events-none absolute inset-x-0 top-2 flex flex-col items-center gap-1.5 px-2">
              {banners.map((b) => (
                <div
                  key={b.id}
                  className={cn(
                    "animate-win-enter rounded-full px-4 py-1.5 text-sm font-bold shadow-lg backdrop-blur",
                    b.win ? (b.bigWin ? "bg-accent-gc/90 text-bg" : "bg-success/90 text-bg") : "bg-surface/90 text-danger"
                  )}
                >
                  {b.win ? `+${formatCoins(b.payoutMinor)} · ${b.multiplier.toFixed(2)}x` : "No win this drop"}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-3">
          <RoundHistory rounds={history} />
        </div>
      </div>

      <div className="space-y-4 lg:w-[240px] lg:shrink-0">
        <BetAmountField valueMinor={betAmount} onChange={setBetAmount} minMinor={config.minBet} maxMinor={config.maxBet} />

        <Select
          label="Rows"
          value={rows}
          disabled={anyInFlight}
          onChange={(e) => setRows(parseInt(e.target.value, 10))}
        >
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
              disabled={anyInFlight}
              className="capitalize"
              size="sm"
            >
              {r}
            </Button>
          ))}
        </div>

        {lastError && <p className="text-xs text-danger">{lastError}</p>}

        <Button className="w-full" size="lg" variant="sc" onClick={onDrop} loading={posting} disabled={dropDisabled}>
          {inFlightCount > 0 ? `Drop ball (${inFlightCount} in flight)` : "Drop ball"}
        </Button>

        <GameInfoSheet seed={seed} loading={loadingSeed} onRotated={onRotated} />
      </div>
    </div>
  );
}
