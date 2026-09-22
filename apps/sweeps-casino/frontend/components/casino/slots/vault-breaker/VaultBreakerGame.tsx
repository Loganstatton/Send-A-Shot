"use client";

// React owns the surrounding shell (bet/currency state, HUD, sheets) and
// talks to the backend via useSlotGame; Pixi (SlotRenderer) owns every pixel
// of reels/symbols/particles/win/bonus animation — this component is the
// bridge between the two, plus the state machine that sequences a spin:
// idle -> spinning -> (win presentation) -> (bonus transition -> N bonus
// spins -> bonus summary) -> idle.
import { useCallback, useEffect, useRef, useState } from "react";
import { useSlotGame } from "@/lib/hooks/useSlotGame";
import { useSoundStore } from "@/lib/stores/sound-store";
import { useWalletStore } from "@/lib/stores/wallet-store";
import { SlotRenderer } from "./engine/SlotRenderer";
import type { WinTier } from "./engine/WinPresentation";
import { tween } from "./engine/animUtils";
import { slotAudio } from "./audio/SlotAudio";
import { BetChipPicker } from "./ui/BetChipPicker";
import { VaultBreakerInfoSheet } from "./ui/VaultBreakerInfoSheet";
import { VaultBreakerLoading } from "./ui/VaultBreakerLoading";
import { VolumeOff, VolumeOn, Info, RefreshCw } from "@/components/ui/icons";
import { cn, formatCoins } from "@/lib/utils";
import type { SlotFreeSpinsResult, SlotSpinResult } from "@/lib/types";

// Presentation-only tiers — the backend has no concept of a win "tier" at
// all, same convention as DiceGame.tsx's BIG_WIN_MULTIPLIER. Multiplier
// here is always of total bet (matches SlotSpinOutcome.appliedMultiplier /
// SlotSpinResult.totalMultiplier), never a fabricated number. Four tiers
// per the brief (NORMAL / BIG / MEGA / EPIC) with escalating cinematic
// weight handled entirely in WinPresentation — these thresholds are ours,
// not a backend contract.
const BIG_WIN_MULTIPLIER = 10;
const MEGA_WIN_MULTIPLIER = 50;
const EPIC_WIN_MULTIPLIER = 150;

function tierFor(multiplier: number): WinTier {
  if (multiplier >= EPIC_WIN_MULTIPLIER) return "epic";
  if (multiplier >= MEGA_WIN_MULTIPLIER) return "mega";
  if (multiplier >= BIG_WIN_MULTIPLIER) return "big";
  return "normal";
}

function tierLabel(tier: WinTier): string {
  switch (tier) {
    case "epic":
      return "EPIC WIN";
    case "mega":
      return "MEGA WIN";
    case "big":
      return "BIG WIN";
    default:
      return "WIN";
  }
}

function tierTextClass(tier: WinTier): string {
  switch (tier) {
    case "epic":
      return "text-transparent bg-clip-text bg-gradient-to-r from-accent-gc via-pink-300 to-accent-sc";
    case "mega":
      return "text-pink-300";
    case "big":
      return "text-accent-gc";
    default:
      return "text-accent-sc";
  }
}

function formatGC(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function vibrate(pattern: number | number[]) {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(pattern);
  } catch {
    // unsupported — ignore
  }
}

function sleepMs(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

type Phase = "idle" | "spinning" | "presenting" | "bonus-intro" | "bonus-spin" | "bonus-summary";

interface WinHud {
  amount: number;
  tier: WinTier;
  label?: string;
}

export function VaultBreakerGame() {
  const { config, loadingConfig, spinning, lastError, spin } = useSlotGame("vault-breaker");
  const soundEnabled = useSoundStore((s) => s.enabled);
  const soundVolume = useSoundStore((s) => s.volume);
  const toggleSound = useSoundStore((s) => s.toggle);

  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<SlotRenderer | null>(null);
  const [rendererReady, setRendererReady] = useState(false);
  const [loadingOverlayVisible, setLoadingOverlayVisible] = useState(true);
  const lastFsMultiplierRef = useRef(0);

  // Starts null (config isn't known yet) and is set to config.minBet the
  // moment config resolves — resolved via `effectiveBet` below rather than
  // an effect, so the reel mount div is present on the very same render
  // config becomes available (an effect+extra-render gap here previously
  // meant the Pixi mount effect's [config?.game] dependency fired one
  // render too early, before the reel div existed, and never fired again).
  const [betAmount, setBetAmount] = useState<number | null>(null);
  // The bet actually used for display/spinning: the player's explicit
  // choice once made, otherwise config.minBet — computed inline (not via
  // a setState effect) so it's correct on the very same render config
  // resolves, with no extra render/effect round trip.
  const effectiveBet = betAmount ?? config?.minBet ?? 0;
  const [phase, setPhase] = useState<Phase>("idle");
  const [betPickerOpen, setBetPickerOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [winHud, setWinHud] = useState<WinHud | null>(null);
  const [winDisplayAmount, setWinDisplayAmount] = useState(0);
  const [errorFlash, setErrorFlash] = useState<string | null>(null);
  const [rendererError, setRendererError] = useState<string | null>(null);

  // Surface the hook's error state as a transient banner without racing the
  // async spin() call's own return value (React batches the hook's
  // setLastError before this effect sees it, so it's always in sync).
  useEffect(() => {
    if (lastError) setErrorFlash(lastError);
  }, [lastError]);

  // ---- Mount the Pixi renderer once config is known ----
  useEffect(() => {
    if (!config || !mountRef.current) return;
    let cancelled = false;
    const el = mountRef.current;
    const rect = el.getBoundingClientRect();
    SlotRenderer.create(el, {
      reels: config.reels,
      rows: config.rows,
      width: Math.max(280, rect.width || 320),
      height: Math.max(280, rect.height || 320),
    })
      .then((renderer) => {
        if (cancelled) {
          renderer.destroy();
          return;
        }
        rendererRef.current = renderer;
        setRendererReady(true);
      })
      .catch((err) => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.error("Vault Breaker: failed to initialize the Pixi renderer", err);
        setRendererError(err instanceof Error ? err.message : "Failed to initialize the game view.");
      });
    return () => {
      cancelled = true;
      rendererRef.current?.destroy();
      rendererRef.current = null;
      setRendererReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.game]);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        rendererRef.current?.resize(width, height);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [rendererReady]);

  const countUpTo = useCallback((target: number, duration = 900) => {
    return tween(
      duration,
      (p) => setWinDisplayAmount(target * p),
      (t) => 1 - Math.pow(1 - t, 3)
    );
  }, []);

  const runBaseSpin = useCallback(
    async (result: SlotSpinResult, bet: number) => {
      const renderer = rendererRef.current;
      if (!renderer || !config) return;

      await renderer.spinToResult(result.base.grid, {
        minScatterCount: config.freeSpins.minScatterCount,
        onReelStop: (i) => {
          if (soundEnabled) slotAudio.reelStop(soundVolume, i);
          if (i === config.reels - 1) vibrate(15);
        },
        onAnticipationStart: () => {
          if (soundEnabled) slotAudio.anticipationTick(soundVolume);
        },
      });

      if (result.base.scatter.count > 0 && soundEnabled) slotAudio.scatterLand(soundVolume);

      if (result.base.win && result.base.paylineWins.length > 0) {
        setPhase("presenting");
        // Derived from the round's real per-outcome multiplier — the base
        // grid's own contribution, shown before any bonus sequence plays.
        // The FINAL number shown at the very end of a round is always
        // result.winAmount/result.totalMultiplier (never this).
        const baseAmount = result.base.appliedMultiplier * bet;
        const tier = tierFor(result.base.appliedMultiplier);
        renderer.celebrateWin(result.base.paylineWins, tier);
        if (soundEnabled) {
          if (tier === "epic" || tier === "mega") slotAudio.megaWin(soundVolume);
          else if (tier === "big") slotAudio.bigWin(soundVolume);
          else slotAudio.symbolWin(soundVolume, result.base.paylineWins[0]?.count ?? 3);
        }
        if (tier !== "normal") vibrate(tier === "epic" ? [50, 70, 50, 70, 50, 70, 120] : tier === "mega" ? [40, 60, 40, 60, 90] : [30, 50, 30]);
        setWinHud({ amount: baseAmount, tier });
        setWinDisplayAmount(0);
        const countDuration = tier === "epic" ? 1700 : tier === "mega" ? 1400 : tier === "big" ? 1100 : 700;
        const holdDuration = tier === "epic" ? 1600 : tier === "mega" ? 1200 : tier === "big" ? 900 : 550;
        await countUpTo(baseAmount, countDuration);
        await sleepMs(holdDuration);
        renderer.clearWin();
        setWinHud(null);
      }
    },
    [config, soundEnabled, soundVolume, countUpTo]
  );

  const runFreeSpins = useCallback(
    async (freeSpins: SlotFreeSpinsResult, bet: number, finalWinAmount: number, finalMultiplier: number) => {
      const renderer = rendererRef.current;
      if (!renderer || !config) return;

      vibrate([30, 40, 30, 40, 80]);
      setPhase("bonus-intro");
      lastFsMultiplierRef.current = 0;
      await renderer.playBonusTransition(freeSpins.spinsAwarded, {
        onLocksRelease: () => {
          if (soundEnabled) slotAudio.vaultUnlock(soundVolume);
        },
        onDoorsOpen: () => {
          if (soundEnabled) slotAudio.bonusTrigger(soundVolume);
          vibrate([20, 30, 20, 30, 60]);
        },
      });
      await renderer.setFreeSpinsEnvironment(true);

      for (let i = 0; i < freeSpins.spins.length; i++) {
        setPhase("bonus-spin");
        const multiplier = freeSpins.multiplierPerSpin[i] ?? freeSpins.finalMultiplier;
        renderer.setFreeSpinsHud({ index: i + 1, total: freeSpins.spins.length, multiplier });
        lastFsMultiplierRef.current = multiplier;
        const outcome = freeSpins.spins[i];
        await renderer.spinToResult(outcome.grid, {
          minScatterCount: config.freeSpins.minScatterCount,
          onReelStop: (idx) => {
            if (soundEnabled) slotAudio.reelStop(soundVolume, idx);
          },
        });
        if (soundEnabled) slotAudio.freeSpinsAmbienceTick(soundVolume);

        if (outcome.win && outcome.paylineWins.length > 0) {
          const amt = outcome.appliedMultiplier * bet;
          const tier = tierFor(outcome.appliedMultiplier);
          renderer.celebrateWin(outcome.paylineWins, tier);
          if (soundEnabled) slotAudio.symbolWin(soundVolume, outcome.paylineWins[0]?.count ?? 3);
          setWinHud({ amount: amt, tier });
          setWinDisplayAmount(0);
          await countUpTo(amt, 550);
          await sleepMs(420);
          renderer.clearWin();
          setWinHud(null);
        } else {
          await sleepMs(200);
        }
      }

      setPhase("bonus-summary");
      const tier = tierFor(finalMultiplier);
      // Authoritative final numbers — always the real backend totals, never
      // a client-summed approximation of the per-spin amounts above.
      setWinHud({ amount: finalWinAmount, tier, label: "TOTAL FREE SPINS WIN" });
      setWinDisplayAmount(0);
      if (soundEnabled) slotAudio.bigWin(soundVolume);
      vibrate([40, 60, 40, 60, 100]);
      await countUpTo(finalWinAmount, 1200);
      await sleepMs(2200);
      renderer.clearWin();
      setWinHud(null);
      renderer.setFreeSpinsHud(null);
      await renderer.setFreeSpinsEnvironment(false);
    },
    [config, soundEnabled, soundVolume, countUpTo]
  );

  const handleSpin = useCallback(async () => {
    if (!config || !rendererRef.current || phase !== "idle" || spinning) return;
    const bet = effectiveBet;
    slotAudio.ensureStarted();
    if (soundEnabled) slotAudio.buttonPress(soundVolume);
    vibrate(10);
    setErrorFlash(null);
    setPhase("spinning");
    rendererRef.current.clearWin();

    const stopLoop = soundEnabled ? slotAudio.spinLoop(soundVolume) : null;
    if (soundEnabled) slotAudio.spinStart(soundVolume);

    const result = await spin(bet);
    stopLoop?.();

    if (!result) {
      setPhase("idle");
      return;
    }

    await runBaseSpin(result, bet);

    if (result.bonusTriggered && result.freeSpins) {
      await runFreeSpins(result.freeSpins, bet, result.winAmount, result.totalMultiplier);
    }

    setPhase("idle");
  }, [config, phase, spinning, effectiveBet, soundEnabled, soundVolume, spin, runBaseSpin, runFreeSpins]);

  const busy = phase !== "idle" || spinning;

  if (loadingConfig || !config) {
    return (
      <div className="relative mx-auto flex min-h-[70vh] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl">
        <VaultBreakerLoading progress={45} ready={false} onDone={() => {}} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-3 lg:max-w-[640px]">
      <div className="flex items-center justify-between px-1">
        <div>
          <p className="text-base font-extrabold tracking-wide text-text-primary">VAULT BREAKER</p>
          <p className="text-[10px] uppercase tracking-[0.25em] text-accent-sc/70">Vaultline Studios</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setInfoOpen(true)}
            aria-label="Paytable and game info"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-text-muted transition-colors hover:text-text-primary"
          >
            <Info className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={toggleSound}
            aria-label={soundEnabled ? "Mute sound" : "Unmute sound"}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-text-muted transition-colors hover:text-text-primary"
          >
            {soundEnabled ? <VolumeOn className="h-4 w-4" /> : <VolumeOff className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="relative aspect-[11/10] w-full overflow-hidden rounded-2xl bg-black shadow-card-lift">
        <div ref={mountRef} className="absolute inset-0" />

        {winHud && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-0.5 p-4 animate-fade-in-up">
            <span className={cn("text-[11px] font-bold uppercase tracking-[0.2em]", tierTextClass(winHud.tier))}>
              {winHud.label ?? tierLabel(winHud.tier)}
            </span>
            <span className="font-mono text-2xl font-extrabold text-white drop-shadow-lg sm:text-3xl">
              {formatGC(winDisplayAmount)} <span className="text-sm text-white/60">GC</span>
            </span>
          </div>
        )}

        {!rendererReady && !rendererError && !loadingOverlayVisible && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent-sc border-t-transparent" />
          </div>
        )}
        {rendererError && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-6 text-center">
            <p className="text-xs text-danger">{rendererError}</p>
          </div>
        )}

        {loadingOverlayVisible && (
          <VaultBreakerLoading
            progress={rendererReady ? 100 : 65}
            ready={rendererReady}
            onDone={() => setLoadingOverlayVisible(false)}
          />
        )}
      </div>

      {errorFlash && <p className="px-1 text-center text-xs text-danger">{errorFlash}</p>}

      {/* Clean bottom HUD: one translucent bar, text segments (no per-item bordered cards), with the spin button floating prominent and centered. */}
      <div className="relative flex items-center gap-2 rounded-2xl bg-surface-raised/80 px-3 py-3 backdrop-blur">
        <button
          type="button"
          onClick={() => setBetPickerOpen(true)}
          disabled={busy}
          className="flex flex-1 flex-col items-start gap-0.5 py-1 text-left transition-opacity disabled:opacity-50"
        >
          <span className="text-[9px] font-semibold uppercase tracking-wider text-text-muted">Bet</span>
          <span className="font-mono text-sm font-bold text-text-primary">{formatGC(effectiveBet)} GC</span>
        </button>

        <div className="mx-1 h-8 w-px shrink-0 bg-border/60" />

        <div className="flex flex-1 flex-col items-center gap-0.5 py-1">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-text-muted">Win</span>
          <span className="font-mono text-sm font-bold text-accent-sc">
            {formatGC(winHud ? winDisplayAmount : 0)} GC
          </span>
        </div>

        <div className="mx-1 h-8 w-px shrink-0 bg-border/60" />

        <div className="flex flex-1 flex-col items-end gap-0.5 py-1">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-text-muted">Balance</span>
          <BalanceReadout />
        </div>

        <button
          type="button"
          onClick={handleSpin}
          disabled={busy}
          aria-label="Spin"
          className={cn(
            "absolute left-1/2 top-0 flex h-[72px] w-[72px] shrink-0 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-4 border-bg bg-gradient-to-b from-accent-sc to-accent-sc/70 text-bg shadow-glow-sc transition-transform duration-150 ease-snappy active:scale-90 disabled:opacity-70 disabled:active:scale-100",
            !busy && "animate-[vb-idle-pulse_2.4s_ease-in-out_infinite]"
          )}
        >
          <RefreshCw className={cn("h-7 w-7", busy && "animate-spin")} />
        </button>
      </div>

      <BetChipPicker
        open={betPickerOpen}
        onClose={() => setBetPickerOpen(false)}
        value={effectiveBet}
        min={config.minBet}
        max={config.maxBet}
        disabled={busy}
        onChange={setBetAmount}
      />
      <VaultBreakerInfoSheet open={infoOpen} onClose={() => setInfoOpen(false)} config={config} />

      <style jsx global>{`
        @keyframes vb-idle-pulse {
          0%,
          100% {
            box-shadow: 0 0 0 0 rgba(45, 191, 176, 0.45);
          }
          50% {
            box-shadow: 0 0 0 8px rgba(45, 191, 176, 0);
          }
        }
      `}</style>
    </div>
  );
}

// wallet-store.ts normalizes every balance to minor units on the way in
// (from both GET /wallet and play-response updates), so this reads the
// same store shape as BalancePill/CurrencySwitcher/the wallet page —
// formatCoins() is the correct, consistent formatter here.
function BalanceReadout() {
  const balance = useWalletStore((s) => s.balances?.gc.balance);
  const fetchBalances = useWalletStore((s) => s.fetchBalances);
  useEffect(() => {
    if (balance === undefined) fetchBalances();
  }, [balance, fetchBalances]);
  return (
    <span className="font-mono text-sm font-bold text-accent-gc">
      {balance !== undefined ? `${formatCoins(balance)} GC` : "—"}
    </span>
  );
}
