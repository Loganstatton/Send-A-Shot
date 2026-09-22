// Environment art: the vault-chamber backdrop, the ornate reel-window
// frame overlay, and the two vault-door leaves used by the free-spins
// "VAULT BREACH" cinematic. Same technique as symbolTextures.ts — layered
// canvas-2D gradients pre-rendered once (or once per resize) to a
// PIXI.Texture, never redrawn per frame.

import { Texture } from "pixi.js";

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Deep vault-chamber background: dark steel walls, a warm spotlight pool behind the reels, teal + gold rim light, riveted plating. */
export function buildBackdropTexture(w: number, h: number): Texture {
  const c = canvas(w, h);
  const ctx = c.getContext("2d")!;

  const base = ctx.createLinearGradient(0, 0, 0, h);
  base.addColorStop(0, "#0a0e18");
  base.addColorStop(0.45, "#111726");
  base.addColorStop(1, "#070a12");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  // Spotlight pool centered where the reel window sits
  const spot = ctx.createRadialGradient(w / 2, h * 0.46, h * 0.05, w / 2, h * 0.46, h * 0.62);
  spot.addColorStop(0, "rgba(45,191,176,0.16)");
  spot.addColorStop(0.55, "rgba(212,175,55,0.06)");
  spot.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, w, h);

  // Riveted plating seams
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = "#232b3d";
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

  // Rivets along seams
  ctx.save();
  ctx.fillStyle = "rgba(212,175,55,0.28)";
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

/** Ornate bevelled-gold frame outline around the reel window, transparent center. */
export function buildReelFrameTexture(w: number, h: number): Texture {
  const c = canvas(w, h);
  const ctx = c.getContext("2d")!;
  const border = Math.max(10, w * 0.018);
  const r = Math.max(14, w * 0.02);

  ctx.save();
  roundRect(ctx, 0, 0, w, h, r);
  roundRect(ctx, border, border, w - border * 2, h - border * 2, r * 0.6);
  ctx.clip("evenodd");

  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, "#f2d98a");
  grad.addColorStop(0.25, "#8a641f");
  grad.addColorStop(0.5, "#d4af37");
  grad.addColorStop(0.75, "#5c4413");
  grad.addColorStop(1, "#f2d98a");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Inner rim highlight
  ctx.globalCompositeOperation = "lighter";
  const inner = ctx.createLinearGradient(0, 0, 0, h);
  inner.addColorStop(0, "rgba(255,255,255,0.35)");
  inner.addColorStop(0.5, "rgba(255,255,255,0)");
  ctx.fillStyle = inner;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // Teal accent hairline just inside the gold
  ctx.save();
  roundRect(ctx, border * 0.55, border * 0.55, w - border * 1.1, h - border * 1.1, r * 0.75);
  ctx.strokeStyle = "rgba(45,191,176,0.55)";
  ctx.lineWidth = Math.max(1.5, w * 0.0025);
  ctx.stroke();
  ctx.restore();

  // Corner medallions
  const corners: [number, number][] = [
    [border / 2, border / 2],
    [w - border / 2, border / 2],
    [border / 2, h - border / 2],
    [w - border / 2, h - border / 2],
  ];
  const medR = border * 0.85;
  corners.forEach(([cx, cy]) => {
    const g = ctx.createRadialGradient(cx - medR * 0.3, cy - medR * 0.3, medR * 0.1, cx, cy, medR);
    g.addColorStop(0, "#fff2c9");
    g.addColorStop(0.5, "#d4af37");
    g.addColorStop(1, "#5c4413");
    ctx.beginPath();
    ctx.arc(cx, cy, medR, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, medR * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = "#0f3b3a";
    ctx.fill();
    ctx.strokeStyle = "#2dbfb0";
    ctx.stroke();
  });

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

  // Concentric bolt rings
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

  // Central hub
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

  // Edge seam (the crack the light bursts through)
  const seamX = side === "left" ? size - size * 0.01 : size * 0.01;
  const seam = ctx.createLinearGradient(seamX - 40, 0, seamX + 40, 0);
  seam.addColorStop(0, "rgba(255,255,255,0)");
  seam.addColorStop(0.5, "rgba(255,247,214,0.9)");
  seam.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = seam;
  ctx.fillRect(seamX - 40, 0, 80, size);

  return Texture.from(c);
}
