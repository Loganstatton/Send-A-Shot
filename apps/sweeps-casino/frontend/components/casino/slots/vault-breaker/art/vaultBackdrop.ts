// Vault Breaker environment art — V3. The vault-chamber backdrop is now the
// REAL provided photographic/illustrated background art (base-game.jpg,
// free-spins.jpg, vault-breach.jpg — a dark steel vault corridor with a
// wheel door, a vault interior flooded with gold coins, and a vault door
// mid-opening with a burst of gold light) loaded as actual textures via
// PIXI.Assets, cover-fit behind the reels with a slow parallax drift.
//
// The old "machine frame" — a thick steel top beam + side supports + base,
// essentially a big rectangular border around everything — is exactly what
// the product owner called out ("a big rectangular border around
// everything... it still looks like a website grid"). It is gone. What
// remains is a SLIM gold/teal trim line hugging the reel window (a few
// pixels, like the bezel on a real cabinet's glass) plus a handful of small
// bolts/lights for material read, and a soft glass-reflection sweep over
// the window — never a boxed-in rectangle that competes with the reels.
//
// The vault-wheel / vault-door-leaf graphics have no static asset (the
// brief explicitly allows procedural generation for effects/motion with no
// provided art) so they stay canvas-drawn, used only for the animated Vault
// Breach cinematic and the free-spins mechanical multiplier dial.

import { Assets, Texture } from "pixi.js";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function roundRectSubpath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  roundRectSubpath(ctx, x, y, w, h, r);
}

function bolt(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  g.addColorStop(0, "#f2e6c4");
  g.addColorStop(0.55, "#9c8a5a");
  g.addColorStop(1, "#2c2411");
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = Math.max(0.5, r * 0.18);
  ctx.stroke();
}

function securityLight(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.save();
  const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
  glow.addColorStop(0, color.replace("ALPHA", "0.5"));
  glow.addColorStop(1, color.replace("ALPHA", "0"));
  ctx.fillStyle = glow;
  ctx.fillRect(x - r * 4, y - r * 4, r * 8, r * 8);
  const lg = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  lg.addColorStop(0, "#eafffb");
  lg.addColorStop(0.6, color.replace("ALPHA", "0.95"));
  lg.addColorStop(1, "#0a1a18");
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = lg;
  ctx.fill();
  ctx.restore();
}

export type BackdropVariant = "base" | "freeSpins" | "breach";

const BACKDROP_SRC: Record<BackdropVariant, string> = {
  base: "/games/vault-breaker/backgrounds/base-game.jpg",
  freeSpins: "/games/vault-breaker/backgrounds/free-spins.jpg",
  breach: "/games/vault-breaker/backgrounds/vault-breach.jpg",
};

let backdropCache: Partial<Record<BackdropVariant, Texture>> = {};

/** Loads a real backdrop photo/illustration as a texture (once, cached). Cover-fit sizing is applied by the caller via sprite scale, not baked in here, so it can be re-fit on resize without a reload. */
export async function loadBackdropTexture(variant: BackdropVariant): Promise<Texture> {
  const cached = backdropCache[variant];
  if (cached) return cached;
  const alias = `vb-bg-${variant}`;
  Assets.add({ alias, src: BACKDROP_SRC[variant] });
  const tex = await Assets.load<Texture>(alias);
  backdropCache[variant] = tex;
  return tex;
}

/**
 * Thin cabinet-glass trim around the reel window: a slim gold/teal bezel
 * line, a handful of corner bolts, and a couple of small security lights on
 * a shallow top strip (just enough height for the free-spins HUD text to
 * sit on) — NOT a thick steel frame. `win` is the real reel-window rect
 * computed by SlotRenderer's layout, never guessed here.
 */
export function buildMachineFrameTexture(w: number, h: number, win: Rect, variant: "base" | "breach" = "base"): Texture {
  const c = canvas(w, h);
  const ctx = c.getContext("2d")!;
  const breach = variant === "breach";
  const accent = breach ? "rgba(255,140,90,ALPHA)" : "rgba(45,191,176,ALPHA)";
  const trimA = breach ? "#8a3a1f" : "#5c4413";
  const trimB = breach ? "#f2a66a" : "#d4af37";

  ctx.clearRect(0, 0, w, h);

  // ---- Slim bezel line around the window ----
  ctx.save();
  const trimGrad = ctx.createLinearGradient(win.x, win.y, win.x, win.y + win.h);
  trimGrad.addColorStop(0, trimB);
  trimGrad.addColorStop(0.5, trimA);
  trimGrad.addColorStop(1, trimB);
  ctx.strokeStyle = trimGrad;
  ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.006);
  roundRect(ctx, win.x, win.y, win.w, win.h, Math.min(win.w, win.h) * 0.02);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1;
  roundRect(ctx, win.x + 1.5, win.y + 1.5, win.w - 3, win.h - 3, Math.min(win.w, win.h) * 0.018);
  ctx.stroke();
  ctx.restore();

  // ---- A few small bolts + security lights hugging the bezel (material read, no boxed rectangle) ----
  const boltR = Math.max(2, Math.min(w, h) * 0.006);
  const lightR = Math.max(2.5, Math.min(w, h) * 0.008);
  const topY = Math.max(4, win.y - boltR * 2.2);
  const lightCount = 5;
  for (let i = 0; i < lightCount; i++) {
    const x = win.x + (win.w / (lightCount - 1)) * i;
    if (i % 2 === 0) securityLight(ctx, x, topY, lightR, accent);
    else bolt(ctx, x, topY, boltR);
  }
  // corner bolts only (no full bolt rows down the sides — that read as a ladder/frame)
  const corners: [number, number][] = [
    [win.x, win.y],
    [win.x + win.w, win.y],
    [win.x, win.y + win.h],
    [win.x + win.w, win.y + win.h],
  ];
  corners.forEach(([mx, my]) => bolt(ctx, mx, my, boltR * 1.3));

  // ---- Glass reflection sweep across the window (subtle, doesn't obscure reels) ----
  ctx.save();
  ctx.beginPath();
  roundRectSubpath(ctx, win.x, win.y, win.w, win.h, Math.min(win.w, win.h) * 0.02);
  ctx.clip();
  const sheen = ctx.createLinearGradient(win.x, win.y, win.x + win.w * 0.55, win.y + win.h);
  sheen.addColorStop(0, "rgba(255,255,255,0.09)");
  sheen.addColorStop(0.35, "rgba(255,255,255,0.02)");
  sheen.addColorStop(0.5, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(win.x, win.y, win.w, win.h * 0.5);
  const topSheen = ctx.createLinearGradient(0, win.y, 0, win.y + win.h * 0.1);
  topSheen.addColorStop(0, "rgba(255,255,255,0.13)");
  topSheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = topSheen;
  ctx.fillRect(win.x, win.y, win.w, win.h * 0.1);
  // Bottom vignette so symbols settle into shadow at the base, grounding them.
  const botVign = ctx.createLinearGradient(0, win.y + win.h * 0.8, 0, win.y + win.h);
  botVign.addColorStop(0, "rgba(0,0,0,0)");
  botVign.addColorStop(1, "rgba(0,0,0,0.22)");
  ctx.fillStyle = botVign;
  ctx.fillRect(win.x, win.y + win.h * 0.8, win.w, win.h * 0.2);
  ctx.restore();

  return Texture.from(c);
}

/** One half of the vault door for the bonus (free spins) breach cinematic. */
export function buildVaultDoorLeafTexture(size: number, side: "left" | "right"): Texture {
  const c = canvas(size, size);
  const ctx = c.getContext("2d")!;
  const cx = side === "left" ? size : 0;
  const cy = size / 2;

  const plate = ctx.createRadialGradient(cx - (side === "left" ? size * 0.25 : -size * 0.25), cy, size * 0.05, cx, cy, size * 0.75);
  plate.addColorStop(0, "#f2d98a");
  plate.addColorStop(0.4, "#c99a2f");
  plate.addColorStop(0.75, "#7a5c17");
  plate.addColorStop(1, "#3a2a0f");
  ctx.fillStyle = plate;
  ctx.fillRect(0, 0, size, size);

  for (let ring = 1; ring <= 4; ring++) {
    const r = size * 0.12 * ring;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(45,20,5,${0.25 + ring * 0.05})`;
    ctx.lineWidth = Math.max(2, size * 0.006);
    ctx.stroke();
    const boltCount = 6 + ring * 4;
    for (let i = 0; i < boltCount; i++) {
      const a = (Math.PI * 2 * i) / boltCount;
      const bx = cx + Math.cos(a) * r;
      const by = cy + Math.sin(a) * r;
      if (bx < -20 || bx > size + 20) continue;
      ctx.beginPath();
      ctx.arc(bx, by, size * 0.006, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(20,12,3,0.7)";
      ctx.fill();
    }
  }

  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.1, 0, Math.PI * 2);
  const hub = ctx.createRadialGradient(cx - size * 0.02, cy - size * 0.02, size * 0.01, cx, cy, size * 0.1);
  hub.addColorStop(0, "#fff2c9");
  hub.addColorStop(1, "#5c4413");
  ctx.fillStyle = hub;
  ctx.fill();
  ctx.strokeStyle = "#2dbfb0";
  ctx.lineWidth = size * 0.008;
  ctx.stroke();

  const seamX = side === "left" ? size - size * 0.01 : size * 0.01;
  const seam = ctx.createLinearGradient(seamX - 40, 0, seamX + 40, 0);
  seam.addColorStop(0, "rgba(255,255,255,0)");
  seam.addColorStop(0.5, "rgba(255,247,214,0.9)");
  seam.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = seam;
  ctx.fillRect(seamX - 40, 0, 80, size);

  return Texture.from(c);
}

/**
 * Standalone vault-wheel graphic (heavy gold rim, bolt ring, spoked handle,
 * teal hub) reused by: the loading screen's animated turning wheel, the
 * bonus intro's rotating mechanism behind the reels, and the in-canvas free
 * spins multiplier dial. Drawn once per size, then rotated live via
 * `sprite.rotation` — never redrawn per frame.
 */
export function buildVaultWheelTexture(size: number): Texture {
  const c = canvas(size, size);
  const ctx = c.getContext("2d")!;
  const r = size * 0.46;
  const cx = size / 2;
  const cy = size / 2;
  ctx.translate(cx, cy);

  const ringGrad = ctx.createRadialGradient(-r * 0.2, -r * 0.25, r * 0.15, 0, 0, r);
  ringGrad.addColorStop(0, "#f2d98a");
  ringGrad.addColorStop(0.55, "#b5862c");
  ringGrad.addColorStop(1, "#5c4415");
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = ringGrad;
  ctx.fill();
  ctx.strokeStyle = "#2dbfb0";
  ctx.lineWidth = Math.max(2, r * 0.045);
  ctx.stroke();

  const boltCount = 12;
  for (let i = 0; i < boltCount; i++) {
    const a = (Math.PI * 2 * i) / boltCount;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r * 0.86, Math.sin(a) * r * 0.86, r * 0.05, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(30,20,5,0.75)";
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
  ctx.fillStyle = "#2a1c08";
  ctx.fill();
  ctx.strokeStyle = "rgba(212,175,55,0.6)";
  ctx.lineWidth = Math.max(1.5, r * 0.025);
  ctx.stroke();

  for (let i = 0; i < 6; i++) {
    ctx.save();
    ctx.rotate((Math.PI / 3) * i);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -r * 0.55);
    ctx.strokeStyle = "#e8c15a";
    ctx.lineWidth = Math.max(3, r * 0.07);
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.restore();
  }

  ctx.beginPath();
  ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2);
  const hub = ctx.createRadialGradient(-r * 0.04, -r * 0.04, r * 0.01, 0, 0, r * 0.18);
  hub.addColorStop(0, "#eafffb");
  hub.addColorStop(1, "#0f6b63");
  ctx.fillStyle = hub;
  ctx.fill();
  ctx.strokeStyle = "#2dbfb0";
  ctx.lineWidth = Math.max(1, r * 0.02);
  ctx.stroke();

  return Texture.from(c);
}

/** A small soft radial glow texture (white center fading to transparent), tinted per-use — shared by win celebration glow and idle ambient particles. Built once, reused everywhere (never a stroked ring/circle — see WinPresentation). */
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
