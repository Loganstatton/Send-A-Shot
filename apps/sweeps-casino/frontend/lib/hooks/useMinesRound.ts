"use client";

// Mines' interactive round flow (start -> pick one tile at a time -> cash
// out whenever) has a genuinely different shape from Dice/Plinko's
// single-shot /play, so it gets its own hook rather than folding more
// branches into useOriginalGame.ts — which stays completely untouched here
// so Dice/Plinko keep working exactly as before. This hook talks to the
// three Mines-specific endpoints (see
// backend/src/modules/casino/originals/mines/mines.controller.ts):
//   POST /casino/originals/mines/start
//   POST /casino/originals/mines/:roundId/pick
//   POST /casino/originals/mines/:roundId/cashout
// The server is authoritative for the mine layout, every pick's outcome,
// and the payout — this hook only renders what those responses say.
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import type { CursorPage, OriginalConfig, OriginalRoundResult, SeedState } from "@/lib/types";
import { useCurrencyStore } from "@/lib/stores/currency-store";
import { useWalletStore } from "@/lib/stores/wallet-store";

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

function fromHistoryEntry(r: RawHistoryEntry): OriginalRoundResult {
  return {
    roundId: r.id,
    game: "mines",
    currency: r.currency,
    betAmount: Number(r.betAmount),
    payout: Number(r.winAmount ?? 0),
    multiplier: Number(r.multiplier ?? 0),
    win: r.winAmount != null && Number(r.winAmount) > 0,
    nonce: Number(r.nonce),
    resultDetail: r.resultPayload ?? {},
    balanceAfter: 0,
    serverSeedHash: r.serverSeedHash,
    clientSeed: r.clientSeed,
  };
}

interface RawStartResponse {
  roundId: string;
  minesCount: number;
  betAmount: string;
  currency: "GC" | "SC";
  replay: boolean;
}

interface RawPickResponse {
  hit: boolean;
  tileIndex: number;
  picks: number[];
  roundStatus: "OPEN" | "SETTLED";
  currentMultiplier: number | null;
  potentialPayout: string | null;
  minePositions: number[] | null;
}

interface RawCashoutResponse {
  round: {
    id: string;
    status: string;
    currency: "GC" | "SC";
    betAmount: string;
    winAmount: string | null;
    multiplier: string | null;
    result: { minesCount: number; minePositions: number[]; picks: number[]; hitMine: boolean };
  };
  win: boolean;
  replay: boolean;
  wallet: { currency: "GC" | "SC"; balance: string };
}

export type MinesRoundPhase = "idle" | "active" | "busted" | "cashed-out";

export interface MinesRoundState {
  roundId: string;
  minesCount: number;
  betAmount: number;
  currency: "GC" | "SC";
  phase: MinesRoundPhase;
  /** Safe tile indices, in the order they were picked. */
  picks: number[];
  hitTileIndex: number | null;
  /** Only populated once the round has ended (busted or cashed out). */
  minePositions: number[] | null;
  /** 0 until the first safe pick. */
  currentMultiplier: number;
  /** Dollar amount, 0 until the first safe pick. */
  potentialPayout: number;
  /** Final credited amount, set once cashed out. */
  finalPayout: number | null;
}

export function useMinesRound() {
  const currency = useCurrencyStore((s) => s.active);
  const applyBalanceUpdate = useWalletStore((s) => s.applyBalanceUpdate);

  const [config, setConfig] = useState<OriginalConfig | null>(null);
  const [seed, setSeed] = useState<SeedState | null>(null);
  const [history, setHistory] = useState<OriginalRoundResult[]>([]);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [loadingSeed, setLoadingSeed] = useState(true);

  const [round, setRound] = useState<MinesRoundState | null>(null);
  const [starting, setStarting] = useState(false);
  const [pickingTile, setPickingTile] = useState<number | null>(null);
  const [cashingOut, setCashingOut] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const refreshHistory = useCallback(() => {
    api
      .get<CursorPage<RawHistoryEntry>>("/casino/originals/mines/history")
      .then((res) => setHistory(res.items.map(fromHistoryEntry)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadingConfig(true);
    api
      .get<RawConfigResponse>("/casino/originals/mines/config")
      .then((c) => !cancelled && setConfig(fromConfigResponse(c)))
      .catch(() => {})
      .finally(() => !cancelled && setLoadingConfig(false));

    setLoadingSeed(true);
    api
      .get<any>("/casino/originals/seeds")
      .then((s) => !cancelled && setSeed(toSeedState(s)))
      .catch(() => {})
      .finally(() => !cancelled && setLoadingSeed(false));

    refreshHistory();

    return () => {
      cancelled = true;
    };
  }, [refreshHistory]);

  function friendlyError(err: unknown, fallback: string): string {
    if (err instanceof ApiError) {
      if (err.code === "INSUFFICIENT_BALANCE") return "Insufficient balance for this bet.";
      return err.message || fallback;
    }
    return fallback;
  }

  const startRound = useCallback(
    async (params: { betAmount: number; minesCount: number }) => {
      setStarting(true);
      setLastError(null);
      try {
        const raw = await api.post<RawStartResponse>(
          "/casino/originals/mines/start",
          { currency, betAmount: (params.betAmount / 100).toFixed(2), minesCount: params.minesCount },
          { idempotent: true }
        );
        setRound({
          roundId: raw.roundId,
          minesCount: raw.minesCount,
          betAmount: Number(raw.betAmount),
          currency: raw.currency,
          phase: "active",
          picks: [],
          hitTileIndex: null,
          minePositions: null,
          currentMultiplier: 0,
          potentialPayout: 0,
          finalPayout: null,
        });
        return true;
      } catch (err) {
        setLastError(friendlyError(err, "Something went wrong starting that round."));
        return false;
      } finally {
        setStarting(false);
      }
    },
    [currency]
  );

  const pickTile = useCallback(
    async (tileIndex: number) => {
      if (!round || round.phase !== "active") return;
      setPickingTile(tileIndex);
      setLastError(null);
      try {
        const raw = await api.post<RawPickResponse>(
          `/casino/originals/mines/${round.roundId}/pick`,
          { tileIndex },
          { idempotent: true }
        );
        setRound((prev) => {
          if (!prev) return prev;
          if (raw.hit) {
            return {
              ...prev,
              phase: "busted",
              hitTileIndex: raw.tileIndex,
              minePositions: raw.minePositions,
              picks: raw.picks,
            };
          }
          return {
            ...prev,
            picks: raw.picks,
            currentMultiplier: raw.currentMultiplier ?? prev.currentMultiplier,
            potentialPayout: raw.potentialPayout ? Number(raw.potentialPayout) : prev.potentialPayout,
          };
        });
        if (raw.hit) refreshHistory();
      } catch (err) {
        setLastError(friendlyError(err, "Something went wrong picking that tile."));
      } finally {
        setPickingTile(null);
      }
    },
    [round, refreshHistory]
  );

  const cashOut = useCallback(async () => {
    if (!round || round.phase !== "active" || round.picks.length === 0) return;
    setCashingOut(true);
    setLastError(null);
    try {
      const raw = await api.post<RawCashoutResponse>(
        `/casino/originals/mines/${round.roundId}/cashout`,
        undefined,
        { idempotent: true }
      );
      applyBalanceUpdate(raw.wallet.currency, Number(raw.wallet.balance));
      setRound((prev) =>
        prev
          ? {
              ...prev,
              phase: "cashed-out",
              minePositions: raw.round.result.minePositions,
              finalPayout: Number(raw.round.winAmount ?? 0),
            }
          : prev
      );
      refreshHistory();
    } catch (err) {
      setLastError(friendlyError(err, "Something went wrong cashing out."));
    } finally {
      setCashingOut(false);
    }
  }, [round, applyBalanceUpdate, refreshHistory]);

  const resetRound = useCallback(() => {
    setRound(null);
    setLastError(null);
  }, []);

  const onRotated = useCallback((raw: any) => setSeed(toSeedState(raw)), []);

  return {
    config,
    seed,
    onRotated,
    history,
    loadingConfig,
    loadingSeed,
    currency,
    round,
    starting,
    pickingTile,
    cashingOut,
    lastError,
    startRound,
    pickTile,
    cashOut,
    resetRound,
  };
}
