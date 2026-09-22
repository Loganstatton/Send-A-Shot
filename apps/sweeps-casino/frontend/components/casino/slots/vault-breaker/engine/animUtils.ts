// Small animation/easing toolkit shared by every engine piece (ReelStrip,
// WinPresentation, FreeSpinsTransition). Nothing here ever decides a
// gameplay outcome — `buildSpinStrip`'s "filler" symbols are purely cosmetic
// filler a reel cycles through before landing on the server's real column.
import type { SlotSymbolId } from "@/lib/types";
import { ALL_SYMBOL_IDS } from "../art/symbolTextures";

export function easeInQuad(t: number): number {
  return t * t;
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
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
 * smooth stop.
 */
export function reelPositionCurve(t: number): number {
  const a = 0.18;
  const aPos = 0.12;
  const b = 0.6;
  const bPos = 0.83;
  if (t <= a) {
    return aPos * easeInQuad(t / a);
  }
  if (t <= b) {
    return aPos + (bPos - aPos) * ((t - a) / (b - a));
  }
  return bPos + (1 - bPos) * easeOutCubic((t - b) / (1 - b));
}

/** Decaying-sine bounce used for the small overshoot after a reel lands. Returns a signed fraction of one cell. */
export function bounceCurve(t: number): number {
  return Math.sin(t * Math.PI * 2.4) * Math.exp(-t * 5.5) * -1;
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
