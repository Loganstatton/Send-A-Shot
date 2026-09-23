// Small shared PixiJS effect-texture helpers — REBUILD (V4).
//
// This module deliberately contains NO "machine art": no bolts, no
// painted-metal gradients, no security lights, no vault-door illustration.
// Per the product owner's explicit placeholder policy for this pass,
// background/frame/glass are simple flat PIXI Graphics (a plain dark
// backdrop, thin metal-toned rules, minimal vignette) — see SlotRenderer's
// buildBackground/buildFrame/buildReelBacking. The two helpers here are
// generic rendering primitives, not art:
//   - getGlowTexture(): a soft radial falloff, reused by every particle/glow
//     effect (win celebration, ambient dust, big-win burst).
//   - buildVerticalGradientTexture(): a plain N-stop linear gradient, reused
//     for the background backdrop / reel backing / vignettes. A gradient is
//     explicitly allowed by the brief ("simple PIXI Graphics gradients are
//     fine here — this is depth/shading, not art"); this is that primitive,
//     not a painted illustration.
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
