// Vault Breaker environment art: the vault-chamber backdrop scene, the
// physical machine frame that surrounds the reel window (steel beams, side
// supports, gold trim, teal security lights, bolts, glass reflection), the
// vault-door leaves used by the free-spins "VAULT BREACH" cinematic, and a
// standalone vault-wheel graphic reused by the loading screen, the breach
// cinematic and the in-canvas free-spins multiplier dial. Same technique as
// symbolTextures.ts — layered canvas-2D gradients pre-rendered once (or once
// per resize) to a PIXI.Texture, never redrawn per frame.
//
// V2: buildReelFrameTexture is gone — a thin gold rectangle border read as
// "a web table with a fancy outline", per the product owner's note. It is
// replaced by buildMachineFrameTexture, which draws a FULL-CANVAS texture
// with a cut window exactly where the reels sit (computed by SlotRenderer's
// layout, not guessed here) so the top beam, side supports and base are
// real chrome with real thickness, not a hairline around the reels.

import { Texture } from "pixi.js";

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
  // Cross-slot
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = Math.max(0.6, r * 0.22);
  ctx.beginPath();
  ctx.moveTo(x - r * 0.55, y);
  ctx.lineTo(x + r * 0.55, y);
  ctx.stroke();
}

function securityLight(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, on = true) {
  ctx.save();
  if (on) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
    glow.addColorStop(0, color.replace("ALPHA", "0.55"));
    glow.addColorStop(1, color.replace("ALPHA", "0"));
    ctx.fillStyle = glow;
    ctx.fillRect(x - r * 4, y - r * 4, r * 8, r * 8);
  }
  const lg = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  lg.addColorStop(0, on ? "#eafffb" : "#3a4550");
  lg.addColorStop(0.6, on ? color.replace("ALPHA", "0.95") : "#222c34");
  lg.addColorStop(1, "#0a1a18");
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = lg;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = Math.max(0.6, r * 0.16);
  ctx.stroke();
  ctx.restore();
}

/** Vertical brushed-steel gradient with subtle horizontal panel banding — the shared material for beams/supports. */
function steelGradient(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, "#3a4453");
  g.addColorStop(0.18, "#5c6a7d");
  g.addColorStop(0.42, "#232a35");
  g.addColorStop(0.6, "#4a5666");
  g.addColorStop(0.82, "#1c222c");
  g.addColorStop(1, "#333d4a");
  return g;
}

type Variant = "base" | "breach";

/** Deep vault-chamber background: steel walls, giant blurred vault-mechanism silhouettes, stacked gold, teal + gold rim light, riveted plating, subtle depth of field. */
export function buildBackdropTexture(w: number, h: number, variant: Variant = "base"): Texture {
  const c = canvas(w, h);
  const ctx = c.getContext("2d")!;
  const breach = variant === "breach";

  const base = ctx.createLinearGradient(0, 0, 0, h);
  if (breach) {
    base.addColorStop(0, "#1a0f08");
    base.addColorStop(0.45, "#241407");
    base.addColorStop(1, "#120a05");
  } else {
    base.addColorStop(0, "#0a0e18");
    base.addColorStop(0.45, "#111726");
    base.addColorStop(1, "#070a12");
  }
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  // --- Depth-of-field layer: giant soft-focus vault mechanism silhouettes, far background ---
  ctx.save();
  ctx.globalAlpha = breach ? 0.22 : 0.14;
  const drawGear = (gx: number, gy: number, r: number, teeth: number, color: string) => {
    ctx.save();
    ctx.translate(gx, gy);
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < teeth * 2; i++) {
      const a = (Math.PI * i) / teeth;
      const rr = i % 2 === 0 ? r : r * 0.86;
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.34, 0, Math.PI * 2);
    ctx.fillStyle = breach ? "#120a05" : "#070a12";
    ctx.fill();
    ctx.restore();
  };
  drawGear(w * 0.08, h * 0.32, h * 0.42, 18, breach ? "#4a2d10" : "#1c2436");
  drawGear(w * 0.95, h * 0.7, h * 0.5, 22, breach ? "#3a2410" : "#161d2c");
  ctx.restore();

  // --- Stacked gold bars silhouette in the far corners ---
  ctx.save();
  ctx.globalAlpha = breach ? 0.55 : 0.22;
  const drawGoldStack = (gx: number, gy: number, scale: number) => {
    for (let i = 0; i < 4; i++) {
      const bw = 46 * scale - i * 3;
      const bh = 16 * scale;
      const bx = gx - bw / 2 + (i % 2 === 0 ? -4 : 4) * scale;
      const by = gy - i * (bh + 2);
      const g = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
      g.addColorStop(0, "#5c4713");
      g.addColorStop(0.5, "#d4af37");
      g.addColorStop(1, "#5c4713");
      ctx.fillStyle = g;
      roundRect(ctx, bx, by, bw, bh, 3 * scale);
      ctx.fill();
    }
  };
  drawGoldStack(w * 0.1, h * 0.97, Math.max(1, w * 0.0022));
  drawGoldStack(w * 0.9, h * 0.98, Math.max(1, w * 0.0026));
  ctx.restore();

  // Spotlight pool centered where the reel window sits
  const spot = ctx.createRadialGradient(w / 2, h * 0.46, h * 0.05, w / 2, h * 0.46, h * 0.62);
  if (breach) {
    spot.addColorStop(0, "rgba(232,183,63,0.24)");
    spot.addColorStop(0.55, "rgba(45,191,176,0.08)");
  } else {
    spot.addColorStop(0, "rgba(45,191,176,0.16)");
    spot.addColorStop(0.55, "rgba(212,175,55,0.06)");
  }
  spot.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, w, h);

  // Gold light leaking from vault seams — thin bright diagonal streaks
  ctx.save();
  ctx.globalAlpha = breach ? 0.5 : 0.22;
  const seamColor = breach ? "rgba(255,205,120,0.9)" : "rgba(212,175,55,0.55)";
  for (const frac of [0.14, 0.86]) {
    const sx = w * frac;
    const seam = ctx.createLinearGradient(sx - w * 0.03, 0, sx + w * 0.03, h);
    seam.addColorStop(0, "rgba(255,255,255,0)");
    seam.addColorStop(0.5, seamColor);
    seam.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = seam;
    ctx.fillRect(sx - w * 0.03, 0, w * 0.06, h);
  }
  ctx.restore();

  // Teal edge lighting along both side walls
  ctx.save();
  const tealL = ctx.createLinearGradient(0, 0, w * 0.16, 0);
  tealL.addColorStop(0, breach ? "rgba(220,90,60,0.35)" : "rgba(45,191,176,0.28)");
  tealL.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = tealL;
  ctx.fillRect(0, 0, w * 0.16, h);
  const tealR = ctx.createLinearGradient(w, 0, w * 0.84, 0);
  tealR.addColorStop(0, breach ? "rgba(220,90,60,0.35)" : "rgba(45,191,176,0.28)");
  tealR.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = tealR;
  ctx.fillRect(w * 0.84, 0, w * 0.16, h);
  ctx.restore();

  // Riveted plating seams
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = breach ? "#3a2818" : "#232b3d";
  ctx.lineWidth = Math.max(1, h * 0.002);
  const cols = 7;
  for (let i = 1; i < cols; i++) {
    const x = (w / cols) * i;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.fillStyle = breach ? "rgba(255,190,120,0.3)" : "rgba(212,175,55,0.28)";
  const rows = Math.round(h / 90);
  for (let i = 1; i < cols; i++) {
    const x = (w / cols) * i;
    for (let j = 0; j < rows; j++) {
      const y = (h / rows) * j + 30;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.5, w * 0.0018), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  // Top + bottom vignette
  const vign = ctx.createLinearGradient(0, 0, 0, h);
  vign.addColorStop(0, "rgba(0,0,0,0.55)");
  vign.addColorStop(0.12, "rgba(0,0,0,0)");
  vign.addColorStop(0.85, "rgba(0,0,0,0)");
  vign.addColorStop(1, "rgba(0,0,0,0.6)");
  ctx.fillStyle = vign;
  ctx.fillRect(0, 0, w, h);

  // Side vignette
  const sideVign = ctx.createLinearGradient(0, 0, w, 0);
  sideVign.addColorStop(0, "rgba(0,0,0,0.5)");
  sideVign.addColorStop(0.1, "rgba(0,0,0,0)");
  sideVign.addColorStop(0.9, "rgba(0,0,0,0)");
  sideVign.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = sideVign;
  ctx.fillRect(0, 0, w, h);

  return Texture.from(c);
}

/**
 * Full-canvas physical machine frame with a transparent cut window exactly
 * at `win` (the real reel-window rect, computed by SlotRenderer — never
 * guessed here). Draws a thick steel top beam, steel side supports, a
 * slimmer steel base, gold mechanical trim lining the window, teal security
 * lights and bolts along every beam, and a soft diagonal glass-reflection
 * sweep across the window itself so the reels read as sitting behind glass.
 */
export function buildMachineFrameTexture(w: number, h: number, win: Rect, variant: Variant = "base"): Texture {
  const c = canvas(w, h);
  const ctx = c.getContext("2d")!;
  const breach = variant === "breach";
  const accent = breach ? "rgba(255,120,90,ALPHA)" : "rgba(45,191,176,ALPHA)";
  const trimA = breach ? "#8a3a1f" : "#5c4413";
  const trimB = breach ? "#f2a66a" : "#d4af37";

  ctx.clearRect(0, 0, w, h);

  // ---- Steel body (everything outside the window) ----
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  roundRectSubpath(ctx, win.x, win.y, win.w, win.h, Math.min(win.w, win.h) * 0.03);
  ctx.clip("evenodd");
  ctx.fillStyle = steelGradient(ctx, 0, 0, w, 0);
  ctx.fillRect(0, 0, w, h);
  // Horizontal brushed streaks for material read
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  for (let y = 0; y < h; y += 5) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.restore();

  // ---- Gold mechanical trim lining the window ----
  ctx.save();
  const trimGrad = ctx.createLinearGradient(win.x, win.y, win.x, win.y + win.h);
  trimGrad.addColorStop(0, trimB);
  trimGrad.addColorStop(0.5, trimA);
  trimGrad.addColorStop(1, trimB);
  ctx.strokeStyle = trimGrad;
  ctx.lineWidth = Math.max(3, Math.min(w, h) * 0.012);
  roundRect(ctx, win.x, win.y, win.w, win.h, Math.min(win.w, win.h) * 0.03);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth = 1.5;
  roundRect(ctx, win.x + 2, win.y + 2, win.w - 4, win.h - 4, Math.min(win.w, win.h) * 0.025);
  ctx.stroke();
  ctx.restore();

  const topBeamH = win.y;
  const bottomBaseH = h - (win.y + win.h);
  const sideW = win.x;

  // ---- Top beam details: bolts + security lights + panel seam ----
  ctx.save();
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = Math.max(1, topBeamH * 0.06);
  ctx.beginPath();
  ctx.moveTo(0, topBeamH * 0.78);
  ctx.lineTo(w, topBeamH * 0.78);
  ctx.stroke();
  const boltR = Math.max(2.5, topBeamH * 0.09);
  const lightR = Math.max(3, topBeamH * 0.13);
  const beamCount = 7;
  for (let i = 0; i < beamCount; i++) {
    const x = (w / (beamCount - 1)) * i;
    if (i % 2 === 0) {
      securityLight(ctx, x, topBeamH * 0.42, lightR, accent, true);
    } else {
      bolt(ctx, x, topBeamH * 0.42, boltR);
    }
  }
  ctx.restore();

  // ---- Side supports: vertical bolt rows + teal strip lights ----
  ctx.save();
  const sideBoltR = Math.max(2, sideW * 0.14);
  const sideRows = Math.max(3, Math.round(win.h / (sideW * 2.4)));
  for (let j = 0; j <= sideRows; j++) {
    const y = win.y + (win.h / sideRows) * j;
    bolt(ctx, sideW * 0.5, y, sideBoltR);
    bolt(ctx, w - sideW * 0.5, y, sideBoltR);
  }
  // Thin vertical accent strip lights
  const stripGradL = ctx.createLinearGradient(0, win.y, 0, win.y + win.h);
  stripGradL.addColorStop(0, accent.replace("ALPHA", "0"));
  stripGradL.addColorStop(0.5, accent.replace("ALPHA", "0.75"));
  stripGradL.addColorStop(1, accent.replace("ALPHA", "0"));
  ctx.fillStyle = stripGradL;
  ctx.fillRect(sideW * 0.16, win.y, Math.max(1.5, sideW * 0.07), win.h);
  ctx.fillRect(w - sideW * 0.16 - Math.max(1.5, sideW * 0.07), win.y, Math.max(1.5, sideW * 0.07), win.h);
  ctx.restore();

  // ---- Base: small vault-mechanism vent + bolts ----
  if (bottomBaseH > 4) {
    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = Math.max(1, bottomBaseH * 0.08);
    ctx.beginPath();
    ctx.moveTo(0, win.y + win.h + bottomBaseH * 0.22);
    ctx.lineTo(w, win.y + win.h + bottomBaseH * 0.22);
    ctx.stroke();
    const by = win.y + win.h + bottomBaseH * 0.55;
    for (let i = 0; i < 9; i++) {
      const x = (w / 8) * i;
      bolt(ctx, x, by, Math.max(2, bottomBaseH * 0.16));
    }
    ctx.restore();
  }

  // ---- Corner mechanism medallions (mini vault-wheel gears) ----
  const medR = Math.max(8, Math.min(sideW, topBeamH) * 0.62);
  const corners: [number, number][] = [
    [win.x, win.y],
    [win.x + win.w, win.y],
    [win.x, win.y + win.h],
    [win.x + win.w, win.y + win.h],
  ];
  corners.forEach(([mx, my]) => {
    ctx.save();
    ctx.translate(mx, my);
    const g = ctx.createRadialGradient(-medR * 0.3, -medR * 0.3, medR * 0.1, 0, 0, medR);
    g.addColorStop(0, "#fff2c9");
    g.addColorStop(0.55, trimB);
    g.addColorStop(1, trimA);
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (Math.PI * i) / 8;
      const r = i % 2 === 0 ? medR : medR * 0.8;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, medR * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = "#0f3b3a";
    ctx.fill();
    ctx.strokeStyle = accent.replace("ALPHA", "0.9");
    ctx.stroke();
    ctx.restore();
  });

  // ---- Glass reflection sweep across the window (subtle, doesn't obscure reels) ----
  ctx.save();
  ctx.beginPath();
  roundRectSubpath(ctx, win.x, win.y, win.w, win.h, Math.min(win.w, win.h) * 0.03);
  ctx.clip();
  const sheen = ctx.createLinearGradient(win.x, win.y, win.x + win.w * 0.55, win.y + win.h);
  sheen.addColorStop(0, "rgba(255,255,255,0.1)");
  sheen.addColorStop(0.35, "rgba(255,255,255,0.02)");
  sheen.addColorStop(0.5, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(win.x, win.y, win.w, win.h * 0.55);
  // faint top glass highlight band
  const topSheen = ctx.createLinearGradient(0, win.y, 0, win.y + win.h * 0.14);
  topSheen.addColorStop(0, "rgba(255,255,255,0.16)");
  topSheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = topSheen;
  ctx.fillRect(win.x, win.y, win.w, win.h * 0.14);
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
