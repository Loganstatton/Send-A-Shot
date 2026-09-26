"use client";

// Generic slot-game data hook, modeled directly on useOriginalGame.ts's
// normalization pattern (raw backend shape -> frontend-convenient shape,
// once, here — never spread across components). Written slot-agnostic
// (any slug) so a future second Vaultline slot can reuse it as-is; Vault
// Breaker is the first and only caller today.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import type { CursorPage, SlotConfig, SlotSpinResult } from "@/lib/types";
import { useWalletStore } from "@/lib/stores/wallet-store";
import { clearPendingSpin, readPendingSpin, writePendingSpin } from "@/lib/spin-attempt";

// Retry policy for a spin whose response we never definitively received
// (network failure, timeout, or a 5xx — anything that ISN'T the backend
// telling us outright "no"). A handful of retries over a few seconds, same
// Idempotency-Key every time: the backend either replays the round that
// already settled from the original attempt, or settles it for the first
// time if that attempt never actually reached it. Either way is safe
// because the key never changes across these attempts.
const RETRY_DELAYS_MS = [800, 1500, 2500];
const SPIN_REQUEST_TIMEOUT_MS = 8000;

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True for a response that definitively means "this wager did not happen" — a real 4xx rejection from the server (bad bet amount, insufficient balance, feature/jurisdiction gate, auth). Retrying with the same key would just hit the identical rejection again, since the backend never settled a round for it. Everything else (network failure, timeout/AbortError, 5xx) is NOT definitive and must be retried with the same key, never surfaced as a false failure. */
function isDefinitiveRejection(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status >= 400 && err.status < 500;
}

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

/**
 * POSTs a spin with a caller-supplied Idempotency-Key, retrying (same key,
 * every time) on anything that isn't a definitive server rejection. Shared
 * by spin() (a fresh attempt) and the mount-time reconciliation effect (an
 * attempt recovered from a previous page load) — both are the exact same
 * "resolve this logical attempt to a final answer" operation, just with a
 * different-sourced idempotencyKey.
 */
async function postSpinWithRetry(
  slug: string,
  idempotencyKey: string,
  currency: "GC" | "SC",
  betAmount: number,
  onRetrying?: (attempt: number) => void
): Promise<RawSpinResponse> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await api.post<RawSpinResponse>(
        `/casino/slots/${slug}/spin`,
        { currency, betAmount: betAmount.toFixed(2) },
        { idempotent: true, idempotencyKey, timeoutMs: SPIN_REQUEST_TIMEOUT_MS }
      );
    } catch (err) {
      if (isDefinitiveRejection(err)) throw err;
      lastErr = err;
      if (attempt < RETRY_DELAYS_MS.length) {
        onRetrying?.(attempt + 1);
        await sleepMs(RETRY_DELAYS_MS[attempt]);
      }
    }
  }
  throw lastErr;
}

export function useSlotGame(slug: string) {
  const applyBalanceUpdate = useWalletStore((s) => s.applyBalanceUpdate);

  const [config, setConfig] = useState<SlotConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [spinning, setSpinning] = useState(false);
  // True while we're mid-retry (or reconciling a resumed attempt) without a
  // definitive answer yet — surfaced separately from `spinning` so the UI
  // can show "couldn't confirm your spin, checking..." instead of either a
  // false failure or an indistinguishable normal spin.
  const [reconciling, setReconciling] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SlotSpinResult | null>(null);
  const [history, setHistory] = useState<SlotSpinResult[]>([]);
  // Synchronous guard against a second concurrent logical spin — a ref, not
  // state, because state updates are batched/async and a rapid double-tap
  // must be rejected on the very next call, not after a re-render (spec:
  // "reject/ignore additional taps, don't queue them").
  const inFlightRef = useRef(false);

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

  const settleFromResponse = useCallback(
    (raw: RawSpinResponse) => {
      const result = fromSpinResponse(raw);
      setLastResult(result);
      setHistory((prev) => [result, ...prev].slice(0, 50));
      applyBalanceUpdate(result.currency, result.balanceAfter);
      return result;
    },
    [applyBalanceUpdate]
  );

  // Reconciliation on mount/resume (state machine step 5): a pending
  // attempt persisted before a reload or backgrounding means the LAST spin
  // never definitively resolved on this device. Re-send it with the exact
  // same stored Idempotency-Key — the backend either replays the round that
  // already settled (the original request actually landed) or settles it
  // for the first time (it never reached the server) — and either way we
  // recover the real result instead of silently losing it or letting the
  // player spin again on top of an unresolved wager. Runs once per mount;
  // `inFlightRef` also protects against a real spin() racing this if the
  // player taps Spin in the same tick (it won't — this fires before the
  // player can interact — but the guard is the same one either way).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const pending = readPendingSpin(slug);
    if (!pending || inFlightRef.current) return;
    inFlightRef.current = true;
    setSpinning(true);
    setReconciling(true);
    postSpinWithRetry(slug, pending.idempotencyKey, pending.currency, pending.betAmount)
      .then((raw) => {
        clearPendingSpin(slug);
        settleFromResponse(raw);
      })
      .catch((err) => {
        if (isDefinitiveRejection(err)) {
          // The wager never happened (or was already known to have failed) —
          // nothing left to recover.
          clearPendingSpin(slug);
        } else {
          setLastError("Couldn't confirm a previous spin — try spinning again.");
        }
        // Non-definitive: leave the pending record in place. It stays
        // eligible for reconciliation on the next mount, or the player can
        // simply try Spin again (a fresh attempt is a separate logical
        // spin — see spin() below — this stale one is abandoned only once
        // it resolves definitively, never silently dropped).
      })
      .finally(() => {
        inFlightRef.current = false;
        setSpinning(false);
        setReconciling(false);
      });
    // Intentionally mount-only per slug — this is a one-shot "recover
    // whatever was pending when this hook instance was created" check, not
    // a subscription that should re-run on every settleFromResponse identity
    // change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const spin = useCallback(
    async (betAmount: number) => {
      // Reject a second concurrent logical spin outright — never queue it
      // (spec: state machine step 1). The Spin button already disables
      // itself while busy; this is the same guarantee enforced at the data
      // layer so it holds regardless of what the UI does.
      if (inFlightRef.current) return null;
      inFlightRef.current = true;
      setSpinning(true);
      setReconciling(false);
      setLastError(null);

      const idempotencyKey =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`;
      const currency: "GC" | "SC" = "GC";
      writePendingSpin(slug, { idempotencyKey, betAmount, currency, createdAt: Date.now() });

      try {
        const raw = await postSpinWithRetry(slug, idempotencyKey, currency, betAmount, () => setReconciling(true));
        clearPendingSpin(slug);
        return settleFromResponse(raw);
      } catch (err) {
        if (isDefinitiveRejection(err)) {
          // The backend rejected the wager outright — never settled, safe
          // to drop the pending record.
          clearPendingSpin(slug);
          const message = err.code === "INSUFFICIENT_BALANCE" ? "Insufficient balance for this bet." : err.message;
          setLastError(message);
        } else {
          // Exhausted retries without ever getting a definitive answer from
          // the server. This is NOT a locally-fabricated failure — we never
          // assume the round didn't happen, and we never generate a fake
          // result to paper over it. The pending record stays persisted so
          // the reconciliation-on-mount effect (or a future retry) can
          // still recover the real outcome with this same key.
          setLastError("Couldn't reach the vault — try again.");
        }
        return null;
      } finally {
        inFlightRef.current = false;
        setSpinning(false);
        setReconciling(false);
      }
    },
    [slug, settleFromResponse]
  );

  return { config, loadingConfig, spinning, reconciling, lastError, lastResult, history, spin };
}
