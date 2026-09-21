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
import { cn } from "@/lib/utils";

type Risk = "low" | "medium" | "high";

export function PlinkoGame() {
  const { config, seed, onRotated, history, loadingConfig, loadingSeed, playing, lastError, lastResult, play } =
    useOriginalGame("plinko");

  const [betAmount, setBetAmount] = useState(100);
  const [rows, setRows] = useState(12);
  const [risk, setRisk] = useState<Risk>("medium");
  const [landedSlot, setLandedSlot] = useState<number | null>(null);

  async function onDrop() {
    const result = await play({ betAmount, rows, risk: risk.toUpperCase() });
    if (result) {
      const bucket = typeof result.resultDetail.bucket === "number" ? (result.resultDetail.bucket as number) : null;
      setLandedSlot(bucket);
    }
  }

  if (loadingConfig || !config) {
    return <Skeleton className="h-96 w-full rounded-xl" />;
  }

  const slotCount = rows + 1;
  const slots = Array.from({ length: slotCount });

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

          <Select label="Rows" value={rows} disabled={playing} onChange={(e) => setRows(parseInt(e.target.value, 10))}>
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
                disabled={playing}
                className="capitalize"
              >
                {r}
              </Button>
            ))}
          </div>

          {lastError && <p className="text-xs text-danger">{lastError}</p>}

          <Button className="w-full" size="lg" onClick={onDrop} loading={playing}>
            Drop ball
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-5">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-end justify-center gap-1 pb-4" style={{ minHeight: 120 }}>
              {slots.map((_, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "flex h-8 flex-1 items-center justify-center rounded text-[10px] font-bold transition-all",
                    landedSlot === idx
                      ? "scale-110 bg-accent-sc text-bg shadow-glow-sc"
                      : "bg-surface-raised text-text-muted"
                  )}
                >
                  {idx}
                </div>
              ))}
            </div>
            {lastResult && (
              <p className={cn("text-center text-sm font-semibold", lastResult.win ? "text-success" : "text-danger")}>
                {lastResult.win ? "Win" : "Loss"} · {lastResult.multiplier.toFixed(2)}x
              </p>
            )}
            {!lastResult && <p className="text-center text-sm text-text-muted">Drop a ball to see where it lands.</p>}
          </CardContent>
        </Card>

        <ProvablyFairPanel seed={seed} loading={loadingSeed} onRotated={onRotated} />
        <RoundHistory rounds={history} />
      </div>
    </div>
  );
}
