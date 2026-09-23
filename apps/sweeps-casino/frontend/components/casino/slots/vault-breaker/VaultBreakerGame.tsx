"use client";

// React owns the surrounding Vaultline application shell (bet/currency
// state, header, bottom control deck, bottom sheets) and talks to the
// backend via useSlotGame; Pixi (SlotRenderer) owns every pixel of
// reels/symbols/particles/win/bonus animation inside the game viewport —
// this component is the bridge between the two, plus the state machine
// that sequences a spin: idle -> spinning -> (win presentation) -> (bonus
// transition -> N bonus spins -> bonus summary) -> idle.
//
// V3: this is now a FULLSCREEN game screen, not a card embedded in the
// normal page flow. It owns the entire viewport (header, cinematic game
// area, control deck) — see app/(game)/casino/slots/[slug]/page.tsx, which
// renders this with no surrounding chrome at all for the vault-breaker
// slug specifically.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useSlotGame } from "@/lib/hooks/useSlotGame";
import { useSoundStore } from "@/lib/stores/sound-store";
import { useWalletStore } from "@/lib/stores/wallet-store";
import { SlotRenderer } from "./engine/SlotRenderer";
import type { WinTier } from "./engine/WinPresentation";
import { tween } from "./engine/animUtils";
import { slotAudio } from "./audio/SlotAudio";
import { BetChipPicker, buildBetPresets } from "./ui/BetChipPicker";
import { VaultBreakerInfoSheet } from "./ui/VaultBreakerInfoSheet";
import { VaultBreakerLoading } from "./ui/VaultBreakerLoading";
import { VolumeOff, VolumeOn, Menu, ChevronLeft, Plus } from "@/components/ui/icons";
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

const TURBO_STORAGE_KEY = "vault-breaker:turbo";

function readTurboPreference(): boolean {
  try {
    return localStorage.getItem(TURBO_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeTurboPreference(on: boolean) {
  try {
    localStorage.setItem(TURBO_STORAGE_KEY, on ? "1" : "0");
  } catch {
    // per-viewer convenience only — ignore if storage is unavailable/blocked.
  }
}

type Phase = "idle" | "spinning" | "presenting" | "bonus-intro" | "bonus-spin" | "bonus-summary";

interface WinHud {
  amount: number;
  tier: WinTier;
  label?: string;
}

export function VaultBreakerGame() {
  const router = useRouter();
  const { config, loadingConfig, spinning, reconciling, lastError, spin } = useSlotGame("vault-breaker");
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
  // Turbo: faster spin, shorter stagger, reduced overshoot (see
  // animUtils.scaleForTurbo) — a persisted per-device preference, read once
  // on mount (avoids a hydration-mismatch flash) and written back on toggle.
  const [turbo, setTurbo] = useState(false);
  useEffect(() => {
    setTurbo(readTurboPreference());
  }, []);
  const toggleTurbo = useCallback(() => {
    setTurbo((prev) => {
      const next = !prev;
      writeTurboPreference(next);
      return next;
    });
  }, []);

  // Autoplay: no existing autoplay state/logic anywhere in the codebase
  // (grepped the frontend before adding this) — a real toggle wired to a
  // local boolean, per spec item 3. It never touches useSlotGame.ts
  // internals: it just re-invokes handleSpin() (the SAME call site the
  // physical SPIN button uses, defined below) on a short timer whenever the
  // machine is idle and autoplay is on, so every autoplay spin gets the
  // exact same presentation/sound/error handling as a manual one. Stops
  // itself the moment an error surfaces (e.g. insufficient balance) so a
  // rejected spin can't loop forever.
  const [autoplay, setAutoplay] = useState(false);
  const autoplayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toggleAutoplay = useCallback(() => {
    setAutoplay((prev) => !prev);
  }, []);
  useEffect(() => {
    return () => {
      if (autoplayTimeoutRef.current) clearTimeout(autoplayTimeoutRef.current);
    };
  }, []);

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
      height: Math.max(280, rect.height || 480),
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

  // Idle ambience: the machine stays visibly alive (drifting particles,
  // gentle WILD pulse, a slow backdrop breathe) whenever nobody is mid-spin
  // — never a fully frozen screen.
  useEffect(() => {
    rendererRef.current?.setIdle(rendererReady && phase === "idle" && !spinning);
  }, [rendererReady, phase, spinning]);

  // `onTick`, when given, also pushes the live value into the in-canvas
  // BIG/MEGA/EPIC win banner (SlotRenderer.setBigWinAmount) — the same
  // count-up drives both the small always-on WIN pill (React state) and,
  // for big+ tiers, the large PixiJS-rendered number, never a duplicated
  // separate DOM "dialog" number for the big-win case.
  const countUpTo = useCallback((target: number, duration = 900, onTick?: (v: number) => void) => {
    return tween(
      duration,
      (p) => {
        const v = target * p;
        setWinDisplayAmount(v);
        onTick?.(v);
      },
      (t) => 1 - Math.pow(1 - t, 3)
    );
  }, []);

  const runBaseSpin = useCallback(
    async (result: SlotSpinResult, bet: number) => {
      const renderer = rendererRef.current;
      if (!renderer || !config) return;

      await renderer.spinToResult(result.base.grid, {
        minScatterCount: config.freeSpins.minScatterCount,
        turbo,
        onReelStop: (i) => {
          if (soundEnabled) slotAudio.reelStop(soundVolume, i);
          if (i === config.reels - 1) vibrate(15);
        },
        onAnticipationStart: () => {
          if (soundEnabled) slotAudio.anticipationTick(soundVolume);
        },
      });

      if (result.base.scatter.count > 0) {
        renderer.pulseScatterLand(result.base.scatter.count);
        if (soundEnabled) slotAudio.scatterLand(soundVolume);
      }

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
        // BIG/MEGA/EPIC: a real in-canvas PixiJS takeover (game pauses,
        // center presentation, gold particles, reels still dimly visible
        // behind). NORMAL: a small in-canvas amount readout at the bottom
        // of the reel window (WinPresentation.setAmount) — both tiers
        // render entirely inside the PixiJS canvas, never a DOM dialog or
        // DOM pill overlapping the reel viewport.
        if (tier !== "normal") await renderer.showBigWinBanner(tierLabel(tier), tier);
        await countUpTo(baseAmount, countDuration, (v) =>
          tier !== "normal" ? renderer.setBigWinAmount(`${formatGC(v)} GC`) : renderer.setNormalWinAmount(`${formatGC(v)} GC`)
        );
        await sleepMs(holdDuration);
        renderer.clearWin();
        if (tier !== "normal") await renderer.hideBigWinBanner();
        setWinHud(null);
      }
    },
    [config, soundEnabled, soundVolume, countUpTo, turbo]
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
          turbo,
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
          if (tier !== "normal") await renderer.showBigWinBanner(tierLabel(tier), tier);
          await countUpTo(amt, 550, (v) =>
            tier !== "normal" ? renderer.setBigWinAmount(`${formatGC(v)} GC`) : renderer.setNormalWinAmount(`${formatGC(v)} GC`)
          );
          await sleepMs(420);
          renderer.clearWin();
          if (tier !== "normal") await renderer.hideBigWinBanner();
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
      if (tier !== "normal") await renderer.showBigWinBanner("TOTAL FREE SPINS WIN", tier);
      await countUpTo(finalWinAmount, 1200, (v) =>
        tier !== "normal" ? renderer.setBigWinAmount(`${formatGC(v)} GC`) : renderer.setNormalWinAmount(`${formatGC(v)} GC`)
      );
      await sleepMs(2200);
      renderer.clearWin();
      if (tier !== "normal") await renderer.hideBigWinBanner();
      setWinHud(null);
      renderer.setFreeSpinsHud(null);
      await renderer.setFreeSpinsEnvironment(false);
    },
    [config, soundEnabled, soundVolume, countUpTo, turbo]
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

  // Drives the autoplay loop: whenever autoplay is on and the machine has
  // settled back to idle with no error showing, queue the next spin a beat
  // later via the exact same handleSpin() the SPIN button calls — never a
  // parallel spin implementation, never a direct interval-driven call into
  // spin()/useSlotGame beyond what handleSpin already does.
  useEffect(() => {
    if (!autoplay || phase !== "idle" || spinning || !config) return;
    if (errorFlash) {
      setAutoplay(false);
      return;
    }
    autoplayTimeoutRef.current = setTimeout(() => {
      handleSpin();
    }, 700);
    return () => {
      if (autoplayTimeoutRef.current) clearTimeout(autoplayTimeoutRef.current);
    };
  }, [autoplay, phase, spinning, config, errorFlash, handleSpin]);

  // BET plate's inline -/+ steppers (spec item 5: "matching the reference's
  // plate style") — steps through the same discrete preset ladder the full
  // BetChipPicker sheet already offers (never a raw +/-1 GC nudge that could
  // land off-ladder), clamped at the ends. Purely a UI convenience on top of
  // the existing setBetAmount/effectiveBet state — no new bet-validation
  // logic, since the backend is the actual authority on bet bounds.
  const stepBet = useCallback(
    (direction: 1 | -1) => {
      if (!config) return;
      const presets = buildBetPresets(config.minBet, config.maxBet);
      const currentIndex = presets.findIndex((p) => Math.abs(p - effectiveBet) < 0.001);
      const fromIndex = currentIndex === -1 ? 0 : currentIndex;
      const nextIndex = Math.max(0, Math.min(presets.length - 1, fromIndex + direction));
      setBetAmount(presets[nextIndex]);
    },
    [config, effectiveBet]
  );

  const busy = phase !== "idle" || spinning;

  if (loadingConfig || !config) {
    return (
      <div className="fixed inset-0 z-40 flex h-[100dvh] w-full flex-col overflow-hidden bg-black">
        <VaultBreakerLoading progress={45} ready={false} onDone={() => {}} />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex h-[100dvh] w-full select-none flex-col overflow-hidden bg-black">
      {/* [Back | Vault Breaker | Balance | Sound | Menu] */}
      <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-white/10 bg-black/70 px-2 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Back"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/80 transition-colors hover:text-white active:scale-90"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="min-w-0 flex-1 truncate text-[13px] font-extrabold tracking-wide text-white">VAULT BREAKER</p>
        <BalanceReadout />
        <button
          type="button"
          onClick={toggleSound}
          aria-label={soundEnabled ? "Mute sound" : "Unmute sound"}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/70 transition-colors hover:text-white active:scale-90"
        >
          {soundEnabled ? <VolumeOn className="h-4 w-4" /> : <VolumeOff className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => setInfoOpen(true)}
          aria-label="Menu and paytable"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/70 transition-colors hover:text-white active:scale-90"
        >
          <Menu className="h-4 w-4" />
        </button>
      </header>

      {/* Cinematic slot game area — the PixiJS/WebGL canvas owns EVERY
          pixel here, including win presentation (BIG+/MEGA/EPIC's banner
          via showBigWinBanner, NORMAL's amount readout via
          setNormalWinAmount) — no DOM element ever overlaps this viewport,
          per the product owner's explicit root-cause callout. */}
      <div className="relative min-h-0 flex-1 bg-black">
        <div ref={mountRef} className="absolute inset-0" />

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

        {errorFlash && (
          <p className="pointer-events-none absolute left-0 right-0 top-2 px-4 text-center text-xs font-medium text-danger drop-shadow">
            {errorFlash}
          </p>
        )}
        {reconciling && !errorFlash && (
          <p className="pointer-events-none absolute left-0 right-0 top-2 px-4 text-center text-xs font-medium text-white/80 drop-shadow">
            Couldn&apos;t confirm your spin, checking…
          </p>
        )}
      </div>

      {/* Control deck: ONE integrated machine housing (spec item 5) — BET
          (left, with -/+ steppers) | SPIN (center, large dual-ring button
          mounted into a recessed socket) | WIN (right), with the turbo
          toggle as a small icon flanking the housing rather than a
          full-width control, continuing the same steel/gold cabinet
          material as the Pixi-rendered machine frame above it instead of
          reading as separate floating boxes. Balance lives in the header
          HUD only (out of scope, unchanged). */}
      <div
        className="relative shrink-0 px-4 pb-[max(10px,env(safe-area-inset-bottom))] pt-4"
        style={{
          background: "linear-gradient(180deg, #1c2029 0%, #12151d 24%, #0a0c12 70%, #050609 100%)",
          borderTop: "2px solid #7a5c22",
          boxShadow: "inset 0 2px 0 rgba(212,175,55,0.35), inset 0 1px 0 rgba(255,255,255,0.06), 0 -6px 18px rgba(0,0,0,0.5)",
        }}
      >
        {/* Corner rivets — the deck reads as the same bolted steel housing as the machine frame above it. */}
        {[
          "left-2 top-2",
          "right-2 top-2",
          "left-2 bottom-2",
          "right-2 bottom-2",
        ].map((pos) => (
          <span
            key={pos}
            className={cn("pointer-events-none absolute h-[7px] w-[7px] rounded-full", pos)}
            style={{
              background: "radial-gradient(circle at 35% 30%, #f0d98a 0%, #b5862c 45%, #3a2a10 100%)",
              boxShadow: "0 1px 2px rgba(0,0,0,0.7)",
            }}
          />
        ))}

        {/* Recessed socket the spin button sits inside — a dark radial
            inset behind the button so the button reads as mounted into
            this surface, not floating above it. */}
        <div
          className="pointer-events-none absolute left-1/2 top-0 h-[128px] w-[128px] -translate-x-1/2 rounded-full"
          style={{
            background: "radial-gradient(circle at 50% 40%, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.3) 55%, transparent 78%)",
            boxShadow: "inset 0 2px 8px rgba(0,0,0,0.65)",
          }}
        />

        <div className="flex items-end justify-between gap-2.5">
          <BetPlate betAmount={effectiveBet} min={config.minBet} max={config.maxBet} busy={busy} onStep={stepBet} onOpenPicker={() => setBetPickerOpen(true)} />

          <SpinButton busy={busy} onPress={handleSpin} />

          <div className="flex min-w-[92px] flex-1 flex-col items-center gap-0.5 rounded-2xl border border-[#3a4152] bg-gradient-to-b from-[#141924] to-[#0a0c13] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),inset_0_-2px_4px_rgba(0,0,0,0.5)]">
            <span className="text-[8px] font-bold uppercase tracking-[0.2em] text-white/45">Win</span>
            <span className="font-mono text-base font-extrabold text-accent-sc drop-shadow-[0_0_6px_rgba(45,191,176,0.35)]">
              {formatGC(winHud ? winDisplayAmount : 0)}
            </span>
          </div>
        </div>

        {/* TURBO / AUTOPLAY — real labeled machine-mounted controls (spec
            item 3), matching the master reference's bottom row exactly: two
            plates in the same dark steel/gold material as BET/WIN above,
            each with an icon + label, not the small unlabeled circular icon
            the previous pass shipped (which came from reviewing a reference
            crop that cut this row off). */}
        <div className="mt-2.5 flex items-stretch gap-2.5">
          <DeckToggleButton active={turbo} onClick={toggleTurbo} label="Turbo" icon={<BoltIcon className="h-3.5 w-3.5" />} />
          <DeckToggleButton active={autoplay} onClick={toggleAutoplay} label="Autoplay" icon={<LoopIcon className="h-3.5 w-3.5" />} />
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

      <style jsx global>{`
        @keyframes vb-idle-pulse {
          0%,
          100% {
            box-shadow: 0 0 0 0 rgba(45, 191, 176, 0.5), 0 0 18px 2px rgba(45, 191, 176, 0.25);
          }
          50% {
            box-shadow: 0 0 0 10px rgba(45, 191, 176, 0), 0 0 26px 6px rgba(212, 175, 55, 0.35);
          }
        }
        @keyframes vb-ring-spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}

/**
 * The spin control: a large premium circular button (~92px, up from V5's
 * 78px — spec item 5: "bigger and more substantial than the current one,
 * matching the reference's proportions") built around the real spin-button
 * art asset (ui/spin-button-idle.png), with the reference's dual-ring
 * treatment — a thick gold outer ring (rotating while spinning) plus a
 * static teal inner glow ring sitting just behind the artwork — a breathing
 * glow while idle, and a physical depress on press. Sits in normal flex
 * flow inside the control deck (over the recessed "socket" the deck draws
 * behind it), so it reads as mounted INTO the machine rather than floating
 * beneath it — no absolute positioning pulling it half outside the deck's
 * own edge.
 */
function SpinButton({ busy, onPress }: { busy: boolean; onPress: () => void }) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      type="button"
      onClick={onPress}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      disabled={busy}
      aria-label="Spin"
      className="relative h-[92px] w-[92px] shrink-0 rounded-full outline-none disabled:cursor-default"
    >
      {/* Static teal inner glow ring — the reference's "thick gold outer
          ring, teal inner glow" pairing, sitting just behind the gold ring
          and the button art. */}
      <span
        className="absolute -inset-[13px] rounded-full blur-[2px]"
        style={{
          background: "radial-gradient(circle, transparent 62%, rgba(45,191,176,0.55) 74%, rgba(45,191,176,0.15) 86%, transparent 100%)",
        }}
      />
      {/* rotating metal outer ring — a masked conic-gradient ring, not
          `border-image` (which ignores `border-radius` and renders as a
          square in every browser — the exact "square ring" bug this
          replaced). The radial-gradient mask punches a transparent hole in
          the middle, so it reads as a true ring regardless of what's
          behind it. Thicker than V5 (10px vs 7px) to read as substantial. */}
      <span
        className={cn("absolute -inset-[10px] rounded-full", busy && "animate-[vb-ring-spin_0.85s_linear_infinite]")}
        style={{
          background: "conic-gradient(from 0deg, #d4af37, #f6e7ae, #8a641f, #d4af37, #f6e7ae, #8a641f, #d4af37)",
          WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 6px), #000 calc(100% - 6px))",
          mask: "radial-gradient(farthest-side, transparent calc(100% - 6px), #000 calc(100% - 6px))",
        }}
      />
      {/* breathing glow when idle */}
      <span
        className={cn("absolute inset-0 rounded-full transition-shadow duration-300", !busy && "animate-[vb-idle-pulse_2.6s_ease-in-out_infinite]")}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/games/vault-breaker/ui/spin-button-idle.png"
        alt=""
        draggable={false}
        className={cn(
          "relative h-full w-full rounded-full object-contain shadow-[0_8px_22px_rgba(0,0,0,0.6)] transition-transform duration-100",
          pressed && !busy && "scale-[0.93] brightness-90",
          busy && "brightness-95"
        )}
      />
      {busy && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/90 border-t-transparent" />
        </span>
      )}
    </button>
  );
}

/**
 * BET plate — label + amount + inline -/+ steppers, matching the
 * reference's plate style (spec item 5). Tapping the amount itself still
 * opens the full BetChipPicker sheet for the complete preset list; -/+ step
 * through the same ladder one preset at a time for quick adjustment without
 * leaving the deck.
 */
function BetPlate({
  betAmount,
  min,
  max,
  busy,
  onStep,
  onOpenPicker,
}: {
  betAmount: number;
  min: number;
  max: number;
  busy: boolean;
  onStep: (direction: 1 | -1) => void;
  onOpenPicker: () => void;
}) {
  const atMin = betAmount <= min + 0.001;
  const atMax = betAmount >= max - 0.001;
  return (
    <div className="flex min-w-[104px] flex-1 flex-col items-center gap-1 rounded-2xl border border-[#3a4152] bg-gradient-to-b from-[#141924] to-[#0a0c13] px-2 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),inset_0_-2px_4px_rgba(0,0,0,0.5)]">
      <span className="text-[8px] font-bold uppercase tracking-[0.2em] text-white/45">Bet</span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onStep(-1)}
          disabled={busy || atMin}
          aria-label="Decrease bet"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#4a5568] bg-[#1b202b] text-white/80 transition-transform active:scale-90 disabled:opacity-35"
        >
          <MinusIcon className="h-2.5 w-2.5" />
        </button>
        <button
          type="button"
          onClick={onOpenPicker}
          disabled={busy}
          className="font-mono text-[15px] font-extrabold text-white transition-opacity disabled:opacity-60"
        >
          {formatGC(betAmount)}
        </button>
        <button
          type="button"
          onClick={() => onStep(1)}
          disabled={busy || atMax}
          aria-label="Increase bet"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#4a5568] bg-[#1b202b] text-white/80 transition-transform active:scale-90 disabled:opacity-35"
        >
          <Plus className="h-2.5 w-2.5" />
        </button>
      </div>
    </div>
  );
}

function MinusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M5 12h14" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
    </svg>
  );
}

function BoltIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth={1}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LoopIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M4 12a8 8 0 0 1 13.9-5.4M20 12a8 8 0 0 1-13.9 5.4"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
      />
      <path d="M18.2 3.2v4.6h-4.6M5.8 20.8v-4.6h4.6" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * TURBO / AUTOPLAY control-deck plate — a labeled, machine-mounted toggle
 * matching BET/WIN's dark steel plate material (spec item 3), with an
 * active state (teal accent glow, same language as the spin button's idle
 * pulse and the BET/WIN plates' accent) so it's obvious at a glance whether
 * turbo/autoplay is engaged.
 */
function DeckToggleButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2.5 text-[10px] font-extrabold uppercase tracking-[0.16em] transition-colors active:scale-[0.97]",
        active
          ? "border-accent-sc bg-accent-sc/15 text-accent-sc shadow-[0_0_10px_rgba(45,191,176,0.4),inset_0_1px_0_rgba(255,255,255,0.08)]"
          : "border-[#3a4152] bg-gradient-to-b from-[#161b26] to-[#0a0c13] text-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),inset_0_-2px_4px_rgba(0,0,0,0.5)]"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// wallet-store.ts normalizes every balance to minor units on the way in
// (from both GET /wallet and play-response updates), so this reads the
// same store shape as BalancePill/CurrencySwitcher/the wallet page —
// formatCoins() is the correct, consistent formatter here.
function BalanceReadout({ compact }: { compact?: boolean }) {
  const balance = useWalletStore((s) => s.balances?.gc.balance);
  const fetchBalances = useWalletStore((s) => s.fetchBalances);
  useEffect(() => {
    if (balance === undefined) fetchBalances();
  }, [balance, fetchBalances]);
  return (
    <span className={cn("shrink-0 font-mono font-bold text-accent-gc", compact ? "text-sm" : "mr-1 text-xs")}>
      {balance !== undefined ? formatCoins(balance) : "—"}
      {!compact && " GC"}
    </span>
  );
}
