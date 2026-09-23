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
