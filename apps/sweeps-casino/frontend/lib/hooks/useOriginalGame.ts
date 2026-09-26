"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import type { CursorPage, OriginalConfig, OriginalRoundResult, SeedState } from "@/lib/types";
import { useCurrencyStore } from "@/lib/stores/currency-store";
import { useWalletStore } from "@/lib/stores/wallet-store";

type GameSlug = "dice" | "mines" | "plinko";

// The backend's actual response shapes (see
// backend/src/modules/casino/originals/*) don't match this hook's simpler
// internal types 1:1 — e.g. /play replies { round, win, wallet }, not a
// flat round — so every raw response is normalized here, once, rather than
// spreading backend-shape knowledge across each game component.

interface RawPlayResponse {
  round: {
    id: string;
    currency: "GC" | "SC";
    betAmount: string;
    winAmount: string | null;
    multiplier: string | null;
    result: Record<string, unknown>;
    serverSeedHash: string;
    clientSeed: string;
    nonce: string;
  };
  win: boolean;
  wallet: { currency: "GC" | "SC"; balance: string };
}

function fromPlayResponse(game: string, resp: RawPlayResponse): OriginalRoundResult {
  return {
    roundId: resp.round.id,
    game,
    currency: resp.round.currency,
    betAmount: Number(resp.round.betAmount),
    payout: Number(resp.round.winAmount ?? 0),
    multiplier: Number(resp.round.multiplier ?? 0),
    win: resp.win,
    nonce: Number(resp.round.nonce),
    resultDetail: resp.round.result ?? {},
    balanceAfter: Number(resp.wallet.balance),
    serverSeedHash: resp.round.serverSeedHash,
    clientSeed: resp.round.clientSeed,
  };
}

interface RawHistoryEntry {
  id: string;
  currency: "GC" | "SC";
  betAmount: string;
  winAmount: string | null;
  multiplier: string | null;
  resultPayload: Record<string, unknown>;
  serverSeedHash: string;
  clientSeed: string;
  nonce: string;
}

function fromHistoryEntry(game: string, r: RawHistoryEntry): OriginalRoundResult {
  return {
    roundId: r.id,
    game,
    currency: r.currency,
    betAmount: Number(r.betAmount),
    payout: Number(r.winAmount ?? 0),
    multiplier: Number(r.multiplier ?? 0),
    win: r.winAmount != null && Number(r.winAmount) > 0,
    nonce: Number(r.nonce),
    resultDetail: r.resultPayload ?? {},
    balanceAfter: 0, // not part of a history row; RoundHistory doesn't render it
    serverSeedHash: r.serverSeedHash,
    clientSeed: r.clientSeed,
  };
}

interface RawConfigResponse {
  game: string;
  minBet: string;
  maxBet: string;
  houseEdgeBps: number;
  seed: { serverSeedHash: string; clientSeed: string; nonce: string };
}

function fromConfigResponse(raw: RawConfigResponse): OriginalConfig {
  return {
    game: raw.game as OriginalConfig["game"],
    minBet: Number(raw.minBet),
    maxBet: Number(raw.maxBet),
    houseEdge: raw.houseEdgeBps / 10000,
    serverSeedHash: raw.seed?.serverSeedHash ?? "",
  };
}

// GET /casino/originals/seeds -> { active, history }
// POST .../seeds/rotate       -> { active, previous }
// PATCH .../seeds/client-seed -> the seed row itself, flat (no wrapper)
// All three funnel through this one normalizer.
function toSeedState(raw: any): SeedState {
  const active = raw?.active ?? raw;
  return {
    serverSeedHash: active?.serverSeedHash ?? "",
    clientSeed: active?.clientSeed ?? "",
    nonce: Number(active?.nonce ?? 0),
    revealedServerSeed: raw?.previous?.serverSeedRevealed ?? null,
    rotatedAt: raw?.previous?.revealedAt,
  };
}

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
      .get<RawConfigResponse>(`/casino/originals/${game}/config`)
      .then((c) => !cancelled && setConfig(fromConfigResponse(c)))
      .catch(() => {})
      .finally(() => !cancelled && setLoadingConfig(false));

    setLoadingSeed(true);
    api
      .get<any>("/casino/originals/seeds")
      .then((s) => !cancelled && setSeed(toSeedState(s)))
      .catch(() => {})
      .finally(() => !cancelled && setLoadingSeed(false));

    api
      .get<CursorPage<RawHistoryEntry>>(`/casino/originals/${game}/history`)
      .then((res) => !cancelled && setHistory(res.items.map((r) => fromHistoryEntry(game, r))))
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [game]);

  const play = useCallback(
    async (params: { betAmount: number; [key: string]: unknown }) => {
      setPlaying(true);
      setLastError(null);
      try {
        // params.betAmount arrives in minor units (cents) per
        // BetAmountField's contract; the backend wants a plain decimal
        // string ("10.00"), matching its fixed-point money model.
        const { betAmount, ...rest } = params;
        const raw = await api.post<RawPlayResponse>(
          `/casino/originals/${game}/play`,
          { currency, betAmount: (betAmount / 100).toFixed(2), ...rest },
          { idempotent: true }
        );
        const result = fromPlayResponse(game, raw);
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

  const onRotated = useCallback((raw: any) => setSeed(toSeedState(raw)), []);

  return {
    config,
    seed,
    setSeed,
    onRotated,
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
