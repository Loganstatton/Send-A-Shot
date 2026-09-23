// Small shared PixiJS effect-texture helpers — REBUILD (V4), environment
// depth pass (V5).
//
// This module deliberately contains NO "machine art": no bolts, no painted
// scenery, no security lights, no vault-door illustration. Per the product
// owner's instruction ("depth shading, not painted scenery"),
// background/frame/glass stay simple procedural gradients — see
// SlotRenderer's background/drawFrame/drawReelBacking. The helpers here are
// generic rendering primitives, not art:
//   - getGlowTexture(): a soft radial falloff, reused by every particle/glow
//     effect (win celebration, ambient dust, big-win burst).
//   - buildVerticalGradientTexture(): a plain N-stop linear gradient, reused
//     for the frame bars / reel backing / vignettes.
//   - buildRadialVignetteTexture(): a plain N-stop radial gradient (a dark
//     vignette, optionally with a tinted edge), used for the game
//     background. Still depth-shading, not a painted illustration — see
//     SYMBOL/ENVIRONMENT art contract in environmentAssets.ts for the real
//     swap-in point.
import { Texture } from "pixi.js";

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** A small soft radial glow texture (white center fading to transparent), tinted per-use — shared by win celebration glow, ambient idle particles, and the big-win burst. Built once, reused everywhere. */
let glowTexCache: Texture | null = null;
export function getGlowTexture(): Texture {
  if (glowTexCache) return glowTexCache;
  const size = 256;
  const c = canvas(size, size);
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glowTexCache = Texture.from(c);
  return glowTexCache;
}

export interface GradientStop {
  offset: number; // 0..1
  color: string; // any canvas-parseable color, e.g. "#0a0e18" or "rgba(0,0,0,0.4)"
}

/** Plain top-to-bottom linear gradient texture — no per-instance caching (callers rebuild on resize), deliberately tiny (1px wide, stretched by the sprite) so it costs nothing to regenerate. */
export function buildVerticalGradientTexture(height: number, stops: GradientStop[]): Texture {
  const h = Math.max(2, Math.round(height));
  const c = canvas(2, h);
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  for (const s of stops) g.addColorStop(s.offset, s.color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2, h);
  return Texture.from(c);
}

/**
 * Full-size radial vignette texture — center lighter/warmer, edges darker
 * (optionally tinted, e.g. a hint of teal in the corners). This is the
 * background layer's CURRENT fill: depth shading via a plain gradient, not
 * painted scenery. `centerY` (0..1, default 0.42) lets the hot spot sit
 * slightly above true center, like a single soft stage light over the
 * machine, without adding any illustrated detail.
 */
export function buildRadialVignetteTexture(width: number, height: number, stops: GradientStop[], centerY = 0.42): Texture {
  const w = Math.max(2, Math.round(width));
  const h = Math.max(2, Math.round(height));
  const c = canvas(w, h);
  const ctx = c.getContext("2d")!;
  const cx = w / 2;
  const cy = h * centerY;
  const r = Math.hypot(w, h) * 0.65;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const s of stops) g.addColorStop(s.offset, s.color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  return Texture.from(c);
}

/** Plain left-to-right linear gradient texture (the horizontal counterpart to buildVerticalGradientTexture) — used for the machine frame's side columns so their steel-to-gold trim varies across the column's THICKNESS (outer edge -> reel-facing inner edge), not along its length. */
export function buildHorizontalGradientTexture(width: number, stops: GradientStop[]): Texture {
  const w = Math.max(2, Math.round(width));
  const c = canvas(w, 2);
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, w, 0);
  for (const s of stops) g.addColorStop(s.offset, s.color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, 2);
  return Texture.from(c);
}

/** Mirrors a set of gradient stops (offset -> 1-offset, order reversed) — used to derive the right-hand frame column's gradient from the left-hand one's outer->inner stops without hand-authoring a second array that has to be kept in sync. */
export function reverseGradientStops(stops: GradientStop[]): GradientStop[] {
  return stops.map((s) => ({ offset: 1 - s.offset, color: s.color })).reverse();
}

/**
 * A soft, heavily-cropped, blurred, low-resolution sample of a source image
 * — background "grain"/texture detail, never the dominant visual element.
 * Cover-fits `sourceW x sourceH` into `destW x destH` anchored at
 * (focalX, focalY) exactly like a CSS `background: cover` + `object-position`
 * would, zooms in a bit further (`extraZoom`) for a more abstract sample, and
 * rasterizes at a fraction of the destination resolution (`resScale`) — the
 * downscale-then-upscale is itself most of the softening; `ctx.filter` blur
 * (best-effort, skipped where unsupported) adds the rest. Returns null if
 * `source` isn't something canvas can draw (e.g. not yet decoded).
 */
export function buildBlurredCoverTexture(
  source: CanvasImageSource | null | undefined,
  sourceW: number,
  sourceH: number,
  destW: number,
  destH: number,
  focalX: number,
  focalY: number,
  opts: { blurPx?: number; resScale?: number; extraZoom?: number } = {}
): Texture | null {
  if (!source || !sourceW || !sourceH || !destW || !destH) return null;
  const { blurPx = 12, resScale = 0.3, extraZoom = 1.15 } = opts;
  const outW = Math.max(2, Math.round(destW * resScale));
  const outH = Math.max(2, Math.round(destH * resScale));
  const c = canvas(outW, outH);
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const srcAspect = sourceW / sourceH;
  const destAspect = destW / destH;
  let drawW: number;
  let drawH: number;
  if (srcAspect > destAspect) {
    drawH = sourceH;
    drawW = sourceH * destAspect;
  } else {
    drawW = sourceW;
    drawH = sourceW / destAspect;
  }
  drawW /= extraZoom;
  drawH /= extraZoom;
  const sx = Math.min(sourceW - drawW, Math.max(0, sourceW * focalX - drawW / 2));
  const sy = Math.min(sourceH - drawH, Math.max(0, sourceH * focalY - drawH / 2));
  try {
    (ctx as CanvasRenderingContext2D & { filter?: string }).filter = `blur(${blurPx}px)`;
  } catch {
    // ctx.filter unsupported in this environment — the downscale/upscale softness alone still applies.
  }
  try {
    ctx.drawImage(source, sx, sy, drawW, drawH, 0, 0, outW, outH);
  } catch {
    return null;
  }
  return Texture.from(c);
}
