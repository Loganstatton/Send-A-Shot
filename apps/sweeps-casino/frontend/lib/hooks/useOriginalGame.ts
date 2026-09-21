"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import type { CursorPage, OriginalConfig, OriginalRoundResult, SeedState } from "@/lib/types";
import { useCurrencyStore } from "@/lib/stores/currency-store";
import { useWalletStore } from "@/lib/stores/wallet-store";

type GameSlug = "dice" | "mines" | "plinko";

export function useOriginalGame(game: GameSlug) {
  const currency = useCurrencyStore((s) => s.active);
  const applyBalanceUpdate = useWalletStore((s) => s.applyBalanceUpdate);

  const [config, setConfig] = useState<OriginalConfig | null>(null);
  const [seed, setSeed] = useState<SeedState | null>(null);
  const [history, setHistory] = useState<OriginalRoundResult[]>([]);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [loadingSeed, setLoadingSeed] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<OriginalRoundResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingConfig(true);
    api
      .get<OriginalConfig>(`/casino/originals/${game}/config`)
      .then((c) => !cancelled && setConfig(c))
      .catch(() => {})
      .finally(() => !cancelled && setLoadingConfig(false));

    setLoadingSeed(true);
    api
      .get<SeedState>("/casino/originals/seeds")
      .then((s) => !cancelled && setSeed(s))
      .catch(() => {})
      .finally(() => !cancelled && setLoadingSeed(false));

    api
      .get<CursorPage<OriginalRoundResult>>(`/casino/originals/${game}/history`)
      .then((res) => !cancelled && setHistory(res.items))
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [game]);

  const play = useCallback(
    async (params: Record<string, unknown>) => {
      setPlaying(true);
      setLastError(null);
      try {
        const result = await api.post<OriginalRoundResult>(
          `/casino/originals/${game}/play`,
          { currency, ...params },
          { idempotent: true }
        );
        setLastResult(result);
        setHistory((prev) => [result, ...prev].slice(0, 50));
        applyBalanceUpdate(result.currency, result.balanceAfter);
        setSeed((prev) => (prev ? { ...prev, nonce: result.nonce + 1 } : prev));
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
        setPlaying(false);
      }
    },
    [game, currency, applyBalanceUpdate]
  );

  return {
    config,
    seed,
    setSeed,
    history,
    loadingConfig,
    loadingSeed,
    playing,
    lastError,
    lastResult,
    play,
    currency,
  };
}
