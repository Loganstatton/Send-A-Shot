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
import { VolumeOff, VolumeOn, Info } from "@/components/ui/icons";
import { cn, formatCoins } from "@/lib/utils";
import type { SlotFreeSpinsResult, SlotSpinResult } from "@/lib/types";

// Presentation-only tiers — the backend has no concept of "big"/"mega"
// win, same convention as DiceGame.tsx's BIG_WIN_MULTIPLIER. Multiplier
// here is always of total bet (matches SlotSpinOutcome.appliedMultiplier /
// SlotSpinResult.totalMultiplier), never a fabricated number.
const BIG_WIN_MULTIPLIER = 10;
const MEGA_WIN_MULTIPLIER = 50;

function tierFor(multiplier: number): WinTier {
  if (multiplier >= MEGA_WIN_MULTIPLIER) return "mega";
  if (multiplier >= BIG_WIN_MULTIPLIER) return "big";
  return "small";
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

interface FreeSpinHud {
  index: number;
  total: number;
  multiplier: number;
}

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
  const [freeSpinsHud, setFreeSpinsHud] = useState<FreeSpinHud | null>(null);
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
          if (tier === "mega") slotAudio.megaWin(soundVolume);
          else if (tier === "big") slotAudio.bigWin(soundVolume);
          else slotAudio.symbolWin(soundVolume, result.base.paylineWins[0]?.count ?? 3);
        }
        if (tier !== "small") vibrate(tier === "mega" ? [40, 60, 40, 60, 90] : [30, 50, 30]);
        setWinHud({ amount: baseAmount, tier });
        setWinDisplayAmount(0);
        await countUpTo(baseAmount, tier === "mega" ? 1400 : tier === "big" ? 1100 : 700);
        await sleepMs(tier === "mega" ? 1200 : tier === "big" ? 900 : 550);
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

      if (soundEnabled) slotAudio.bonusTrigger(soundVolume);
      vibrate([30, 40, 30, 40, 80]);
      setPhase("bonus-intro");
      await renderer.playBonusTransition(freeSpins.spinsAwarded);

      for (let i = 0; i < freeSpins.spins.length; i++) {
        setPhase("bonus-spin");
        setFreeSpinsHud({
          index: i + 1,
          total: freeSpins.spins.length,
          multiplier: freeSpins.multiplierPerSpin[i] ?? freeSpins.finalMultiplier,
        });
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
      setFreeSpinsHud(null);
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
    return <VaultBreakerLoading progress={rendererReady ? 80 : 45} />;
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

      <div className="relative aspect-[5/6.5] w-full overflow-hidden rounded-2xl border border-border/60 bg-black shadow-card-lift lg:aspect-[5/4.6]">
        <div ref={mountRef} className="absolute inset-0" />

        {freeSpinsHud && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-3 animate-fade-in">
            <span className="rounded-full border border-accent-sc/50 bg-black/60 px-3 py-1 text-[11px] font-bold text-accent-sc backdrop-blur">
              FREE SPINS {freeSpinsHud.index}/{freeSpinsHud.total}
            </span>
            <span className="rounded-full border border-accent-gc/50 bg-black/60 px-3 py-1 text-[11px] font-bold text-accent-gc backdrop-blur">
              VAULT MULTIPLIER {freeSpinsHud.multiplier}x
            </span>
          </div>
        )}

        {winHud && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-0.5 p-4 animate-fade-in-up">
            <span
              className={cn(
                "text-[11px] font-bold uppercase tracking-[0.2em]",
                winHud.tier === "mega" ? "text-pink-300" : winHud.tier === "big" ? "text-accent-gc" : "text-accent-sc"
              )}
            >
              {winHud.label ?? (winHud.tier === "mega" ? "MEGA WIN" : winHud.tier === "big" ? "BIG WIN" : "WIN")}
            </span>
            <span className="font-mono text-2xl font-extrabold text-white drop-shadow-lg sm:text-3xl">
              {formatGC(winDisplayAmount)} <span className="text-sm text-white/60">GC</span>
            </span>
          </div>
        )}

        {!rendererReady && !rendererError && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent-sc border-t-transparent" />
          </div>
        )}
        {rendererError && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-6 text-center">
            <p className="text-xs text-danger">{rendererError}</p>
          </div>
        )}
      </div>

      {errorFlash && <p className="px-1 text-center text-xs text-danger">{errorFlash}</p>}

      <div className="flex items-center gap-3 rounded-2xl bg-surface-raised p-3">
        <button
          type="button"
          onClick={() => setBetPickerOpen(true)}
          disabled={busy}
          className="flex flex-1 flex-col items-start rounded-xl border border-border bg-surface px-4 py-2.5 text-left transition-colors hover:border-accent-gc/40 disabled:opacity-50"
        >
          <span className="text-[10px] font-medium uppercase tracking-wide text-text-muted">Bet</span>
          <span className="font-mono text-sm font-bold text-text-primary">{formatGC(effectiveBet)} GC</span>
        </button>

        <button
          type="button"
          onClick={handleSpin}
          disabled={busy}
          aria-label="Spin"
          className={cn(
            "flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-accent-sc to-accent-sc/80 text-sm font-extrabold uppercase tracking-wide text-bg shadow-glow-sc transition-all duration-150 ease-snappy active:scale-90 disabled:opacity-60 disabled:active:scale-100"
          )}
        >
          {busy ? (
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-bg/70 border-t-transparent" />
          ) : (
            "Spin"
          )}
        </button>

        <div className="flex flex-1 flex-col items-end rounded-xl border border-border bg-surface px-4 py-2.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-text-muted">Balance</span>
          <BalanceReadout />
        </div>
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
