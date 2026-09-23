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
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import { VolumeOff, VolumeOn, Menu, ChevronLeft } from "@/components/ui/icons";
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

type Phase = "idle" | "spinning" | "presenting" | "bonus-intro" | "bonus-spin" | "bonus-summary";

interface WinHud {
  amount: number;
  tier: WinTier;
  label?: string;
}

export function VaultBreakerGame() {
  const router = useRouter();
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
      </div>

      {/* Control deck: BET (left) | SPIN (center, mounted into the deck) |
          WIN + BALANCE (right) — one continuous panel, not scattered
          floating labels (spec point 17). The spin button sits in a
          recessed "socket" cut into the deck surface (a radial shadow
          behind it) so it reads as physically built into the machine
          rather than floating beneath it (spec point 18). */}
      <div
        className="relative shrink-0 border-t border-white/10 bg-gradient-to-b from-[#12151f] to-[#05070a] px-4 pb-[max(10px,env(safe-area-inset-bottom))] pt-3"
        style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)" }}
      >
        {/* Recessed socket the spin button sits inside — a dark radial
            inset behind the button so the button reads as mounted into
            this surface, not floating above it. */}
        <div
          className="pointer-events-none absolute left-1/2 top-0 h-[104px] w-[104px] -translate-x-1/2 rounded-full"
          style={{
            background: "radial-gradient(circle at 50% 42%, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.28) 55%, transparent 78%)",
            boxShadow: "inset 0 2px 6px rgba(0,0,0,0.6)",
          }}
        />

        <div className="flex items-end justify-between gap-3">
          <button
            type="button"
            onClick={() => setBetPickerOpen(true)}
            disabled={busy}
            className="flex min-w-[76px] flex-col items-start gap-0.5 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-left transition-opacity active:scale-95 disabled:opacity-50"
          >
            <span className="text-[8px] font-semibold uppercase tracking-wider text-white/50">Bet</span>
            <span className="font-mono text-sm font-bold text-white">{formatGC(effectiveBet)}</span>
          </button>

          <SpinButton busy={busy} onPress={handleSpin} />

          <div className="flex min-w-[88px] flex-col items-end gap-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2">
            <span className="flex w-full items-baseline justify-between gap-2 text-[8px] font-semibold uppercase tracking-wider text-white/50">
              Win
            </span>
            <span className="font-mono text-sm font-bold text-accent-sc">{formatGC(winHud ? winDisplayAmount : 0)}</span>
            <div className="h-px w-full bg-white/10" />
            <span className="flex w-full items-baseline justify-between gap-2 text-[8px] font-semibold uppercase tracking-wider text-white/50">
              Balance
            </span>
            <BalanceReadout compact />
          </div>
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
 * The spin control: a large premium circular button (~78px — spec point 18's
 * 72-84px range) built around the real spin-button art asset
 * (ui/spin-button-idle.png), a metal outer ring that rotates while
 * spinning, a breathing glow while idle, and a physical depress on press.
 * Sits in normal flex flow inside the control deck (over the recessed
 * "socket" the deck draws behind it), so it reads as mounted INTO the
 * machine rather than floating beneath it (spec point 18) — no absolute
 * positioning pulling it half outside the deck's own edge.
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
      className="relative h-[78px] w-[78px] shrink-0 rounded-full outline-none disabled:cursor-default"
    >
      {/* rotating metal outer ring — a masked conic-gradient ring, not
          `border-image` (which ignores `border-radius` and renders as a
          square in every browser — the exact "square ring" bug this
          replaced). The radial-gradient mask punches a transparent hole in
          the middle, so it reads as a true ring regardless of what's
          behind it. */}
      <span
        className={cn("absolute -inset-[7px] rounded-full", busy && "animate-[vb-ring-spin_0.85s_linear_infinite]")}
        style={{
          background: "conic-gradient(from 0deg, #d4af37, #f6e7ae, #8a641f, #d4af37, #f6e7ae, #8a641f, #d4af37)",
          WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 4px))",
          mask: "radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 4px))",
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
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/90 border-t-transparent" />
        </span>
      )}
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
