"use client";

// Generic slot-game data hook, modeled directly on useOriginalGame.ts's
// normalization pattern (raw backend shape -> frontend-convenient shape,
// once, here — never spread across components). Written slot-agnostic
// (any slug) so a future second Vaultline slot can reuse it as-is; Vault
// Breaker is the first and only caller today.
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import type { CursorPage, SlotConfig, SlotSpinResult } from "@/lib/types";
import { useWalletStore } from "@/lib/stores/wallet-store";

interface RawSlotConfig {
  game: string;
  reels: number;
  rows: number;
  paylineCount: number;
  minBet: string;
  maxBet: string;
  symbols: SlotConfig["symbols"];
  paytable: SlotConfig["paytable"];
  freeSpins: SlotConfig["freeSpins"];
  freeSpinsMultiplier: SlotConfig["freeSpinsMultiplier"];
  seed: { serverSeedHash: string; clientSeed: string; nonce: string };
}

function fromConfigResponse(raw: RawSlotConfig): SlotConfig {
  return {
    game: raw.game,
    reels: raw.reels,
    rows: raw.rows,
    paylineCount: raw.paylineCount,
    minBet: Number(raw.minBet),
    maxBet: Number(raw.maxBet),
    symbols: raw.symbols,
    paytable: raw.paytable,
    freeSpins: raw.freeSpins,
    freeSpinsMultiplier: raw.freeSpinsMultiplier,
    serverSeedHash: raw.seed?.serverSeedHash ?? "",
    clientSeed: raw.seed?.clientSeed ?? "",
    nonce: Number(raw.seed?.nonce ?? 0),
  };
}

interface RawSpinResponse {
  round: {
    id: string;
    status: string;
    currency: "GC" | "SC";
    betAmount: string;
    winAmount: string;
    multiplier: string;
    result: {
      win: boolean;
      base: any;
      freeSpins: any;
      bonusTriggered: boolean;
      totalMultiplier: number;
    };
    serverSeedHash: string;
    serverSeedRevealed: string | null;
    clientSeed: string;
    nonce: string;
  };
  win: boolean;
  replay: boolean;
  wallet: { currency: "GC" | "SC"; balance: string };
}

function fromSpinResponse(resp: RawSpinResponse): SlotSpinResult {
  const r = resp.round;
  return {
    roundId: r.id,
    currency: r.currency,
    betAmount: Number(r.betAmount),
    winAmount: Number(r.winAmount ?? 0),
    multiplier: Number(r.multiplier ?? 0),
    win: resp.win,
    base: r.result.base,
    freeSpins: r.result.freeSpins ?? null,
    bonusTriggered: !!r.result.bonusTriggered,
    totalMultiplier: Number(r.result.totalMultiplier ?? 0),
    balanceAfter: Number(resp.wallet.balance),
    serverSeedHash: r.serverSeedHash,
    clientSeed: r.clientSeed,
    nonce: Number(r.nonce),
  };
}

export function useSlotGame(slug: string) {
  const applyBalanceUpdate = useWalletStore((s) => s.applyBalanceUpdate);

  const [config, setConfig] = useState<SlotConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SlotSpinResult | null>(null);
  const [history, setHistory] = useState<SlotSpinResult[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoadingConfig(true);
    api
      .get<RawSlotConfig>(`/casino/slots/${slug}/config`)
      .then((c) => !cancelled && setConfig(fromConfigResponse(c)))
      .catch(() => {})
      .finally(() => !cancelled && setLoadingConfig(false));

    api
      .get<CursorPage<any>>(`/casino/slots/${slug}/history`)
      .then((res) => {
        if (cancelled) return;
        setHistory(
          res.items.map((r: any) => ({
            roundId: r.id,
            currency: r.currency,
            betAmount: Number(r.betAmount),
            winAmount: Number(r.winAmount ?? 0),
            multiplier: Number(r.multiplier ?? 0),
            win: r.winAmount != null && Number(r.winAmount) > 0,
            base: r.resultPayload?.base ?? r.resultPayload,
            freeSpins: r.resultPayload?.freeSpins ?? null,
            bonusTriggered: !!r.resultPayload?.bonusTriggered,
            totalMultiplier: Number(r.resultPayload?.totalMultiplier ?? r.multiplier ?? 0),
            balanceAfter: 0,
            serverSeedHash: r.serverSeedHash,
            clientSeed: r.clientSeed,
            nonce: Number(r.nonce),
          }))
        );
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const spin = useCallback(
    async (betAmount: number) => {
      setSpinning(true);
      setLastError(null);
      try {
        const raw = await api.post<RawSpinResponse>(
          `/casino/slots/${slug}/spin`,
          { currency: "GC", betAmount: betAmount.toFixed(2) },
          { idempotent: true }
        );
        const result = fromSpinResponse(raw);
        setLastResult(result);
        setHistory((prev) => [result, ...prev].slice(0, 50));
        applyBalanceUpdate(result.currency, result.balanceAfter);
        return result;
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.code === "INSUFFICIENT_BALANCE"
              ? "Insufficient balance for this bet."
              : err.message
            : "Something went wrong placing that bet.";
        setLastError(message);
        return null;
      } finally {
        setSpinning(false);
      }
    },
    [slug, applyBalanceUpdate]
  );

  return { config, loadingConfig, spinning, lastError, lastResult, history, spin };
}
