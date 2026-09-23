// Small animation/easing toolkit shared by every engine piece (ReelStrip,
// WinPresentation, FreeSpinsTransition). Nothing here ever decides a
// gameplay outcome — `buildSpinStrip`'s "filler" symbols are purely cosmetic
// filler a reel cycles through before landing on the server's real column.
import type { SlotSymbolId } from "@/lib/types";
import { ALL_SYMBOL_IDS } from "../art/symbolAssets";

export function easeInQuad(t: number): number {
  return t * t;
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Steeper-tailed sibling of easeOutCubic — decelerates harder near the end, which is what actually reads as a reel "catching" rather than gliding to a stop. Used for a spinning reel's main deceleration phase. */
export function easeOutQuint(t: number): number {
  return 1 - Math.pow(1 - t, 5);
}

export function easeOutBack(t: number, overshoot = 1.7): number {
  const c1 = overshoot;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

/** Filler pool excludes SCATTER (real strips heavily de-weight it) — cosmetic only. */
const FILLER_POOL: SlotSymbolId[] = ALL_SYMBOL_IDS.filter((id) => id !== "SCATTER");

function randomFiller(): SlotSymbolId {
  return FILLER_POOL[Math.floor(Math.random() * FILLER_POOL.length)];
}

/**
 * Strip = [leadIn (what's already on screen, so the spin starts with zero
 * visual jump)] + [random cosmetic filler] + [finalColumn, top-to-bottom —
 * the server's real, already-determined result]. The reel animates its
 * position from 0 to exactly `strip.length - finalColumn.length`, which by
 * construction lands it precisely on `finalColumn`.
 */
export function buildSpinStrip(
  leadIn: SlotSymbolId[],
  finalColumn: SlotSymbolId[],
  fillerCount: number
): SlotSymbolId[] {
  const filler: SlotSymbolId[] = [];
  for (let i = 0; i < fillerCount; i++) filler.push(randomFiller());
  return [...leadIn, ...filler, ...finalColumn];
}

/**
 * Piecewise accelerate -> cycle -> decelerate position curve. `t` and the
 * return value are both fractions in [0,1] (elapsed time / total distance).
 * Not physically exact (segments aren't slope-matched at the boundaries)
 * but reads convincingly as a real reel: slow start, fast cycling blur,
 * smooth stop. `accelFrac`/`decelFrac` are the accel/decel phases as a
 * fraction of the TOTAL duration — see reelPositionCurveMs, which is what
 * ReelStrip actually calls (it converts literal ms breakpoints into these
 * fractions per-reel, so every reel's acceleration reads as ~150ms in real
 * time regardless of that reel's own total duration — see spec point 6/7:
 * "ACCELERATION (0-150ms)... per-reel personality").
 */
export function reelPositionCurve(t: number, accelFrac = 0.18, decelFrac = 0.4): number {
  const a = Math.min(0.45, Math.max(0.02, accelFrac));
  const b = Math.max(a + 0.05, 1 - Math.min(0.6, Math.max(0.05, decelFrac)));
  // Position reached at the end of the accel ramp (t=a), continuing the
  // full-speed segment at that same instantaneous slope so the curve has no
  // visible kink at the accel->full-speed boundary.
  const aPos = a * 0.62;
  const bPos = aPos + (b - a) * 1.0; // full-speed segment: constant velocity 1.0 (matches accel ramp's exit slope closely enough to read as smooth)
  if (t <= a) {
    return aPos * easeInQuad(t / a);
  }
  if (t <= b) {
    return aPos + (bPos - aPos) * ((t - a) / (b - a));
  }
  // easeOutQuint for the deceleration tail (ported from the reference demo)
  // — a harder catch right at the very end reads more like a reel actually
  // stopping under its own weight than easeOutCubic's more even glide.
  return bPos + (1 - bPos) * easeOutQuint((t - b) / (1 - b));
}

/** Per-reel timing/feel — deliberately distinct per reel (spec point 7: "reels do not stop identically"). `duration` is the main spin tween length; total on-screen settle time is duration + bounceMs. accelMs/decelMs are literal-ms phase lengths (converted to fractions of `duration` by ReelStrip), so every reel's acceleration burst reads as ~140-160ms in real time no matter how long that reel spins overall. */
export interface ReelPersonality {
  duration: number;
  accelMs: number;
  decelMs: number;
  bounceMs: number;
  bounceAmpPx: number;
}

// Target on-screen settle times (duration + bounceMs) land close to the
// spec's example: reel1 ~950ms, reel2 ~1070ms, reel3 ~1190ms, reel4
// ~1310ms, reel5 ~1430ms — a consistent ~110-120ms stagger, with each
// reel's own deceleration/bounce weight growing slightly heavier moving
// right, so the machine reads as five distinct mechanisms, not one curve
// copy-pasted five times.
export const REEL_PERSONALITY: ReelPersonality[] = [
  { duration: 810, accelMs: 140, decelMs: 260, bounceMs: 140, bounceAmpPx: 3 },
  { duration: 920, accelMs: 150, decelMs: 280, bounceMs: 150, bounceAmpPx: 3.5 },
  { duration: 1030, accelMs: 150, decelMs: 300, bounceMs: 160, bounceAmpPx: 4 },
  { duration: 1140, accelMs: 160, decelMs: 320, bounceMs: 170, bounceAmpPx: 4 },
  { duration: 1250, accelMs: 160, decelMs: 340, bounceMs: 180, bounceAmpPx: 4.5 },
];

/** Decaying-sine bounce used for the small overshoot after a reel lands. Returns a signed fraction of one cell. */
export function bounceCurve(t: number): number {
  return Math.sin(t * Math.PI * 2.4) * Math.exp(-t * 5.5) * -1;
}

/**
 * easeOutBack-driven settle: starts at 0, overshoots past 1, eases back to
 * exactly 1 — ported from the reference demo's overshoot/settle feel
 * (there, applied directly to reel position; here, applied to the small
 * mechanical bounceLayer offset that plays after a reel lands, which is
 * this engine's equivalent). `overshoot` controls how pronounced the
 * spring-back reads.
 */
export function easeOutBackSettle(t: number, overshoot = 1.7): number {
  return easeOutBack(t, overshoot) - 1;
}

/** Turbo mode: faster spin, shorter duration, and a visibly reduced (never fully removed — it's the one settle cue that sells "this reel just stopped") overshoot bounce. Applied uniformly to a per-reel ReelPersonality rather than baking a second turbo table. */
export function scaleForTurbo(p: ReelPersonality, turbo: boolean): ReelPersonality {
  if (!turbo) return p;
  return {
    duration: Math.round(p.duration * 0.5),
    accelMs: Math.round(p.accelMs * 0.6),
    decelMs: Math.round(p.decelMs * 0.55),
    bounceMs: Math.round(p.bounceMs * 0.5),
    bounceAmpPx: p.bounceAmpPx * 0.35,
  };
}

/** Per-reel spin START delay (ms) — reels don't all begin moving in the same frame, ported from the reference demo's `startTime = now + i*(turbo?18:42)`. */
export function reelStartDelayMs(reelIndex: number, turbo: boolean): number {
  return reelIndex * (turbo ? 18 : 42);
}

export interface TweenHandle {
  cancel: () => void;
}

/** Runs `onUpdate(progress 0..1)` every animation frame for `duration` ms, then resolves. Returns a handle to cancel early. */
export function tween(duration: number, onUpdate: (p: number) => void, ease: (t: number) => number = (t) => t): Promise<void> & TweenHandle {
  let cancelled = false;
  let raf = 0;
  const promise = new Promise<void>((resolve) => {
    const start = performance.now();
    const frame = (now: number) => {
      if (cancelled) return;
      const t = Math.min(1, (now - start) / duration);
      onUpdate(ease(t));
      if (t < 1) {
        raf = requestAnimationFrame(frame);
      } else {
        resolve();
      }
    };
    raf = requestAnimationFrame(frame);
  }) as Promise<void> & TweenHandle;
  promise.cancel = () => {
    cancelled = true;
    cancelAnimationFrame(raf);
  };
  return promise;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
