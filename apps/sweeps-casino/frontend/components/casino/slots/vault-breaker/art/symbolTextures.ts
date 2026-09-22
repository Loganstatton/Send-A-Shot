// Vault Breaker symbol art. No image-generation tool is available in this
// environment, so there is no photographic/illustrated art here — instead
// every symbol is a layered, hand-authored 2D-canvas composition (multiple
// gradients, shadows, highlight sweeps, metallic bevels) rendered ONCE per
// symbol to an offscreen canvas and uploaded to the GPU as a single
// PIXI.Texture, reused by every sprite that shows that symbol (the "pool,
// don't recreate" performance rule from the brief). This is the same
// spirit as components/casino/originals-art.tsx / category-art.tsx's
// deterministic layered-gradient house style, taken further since this is
// the flagship game.
//
// Each symbol gets a shared "premium plaque" frame (bevelled metal border,
// inner shadow, top glass highlight — the kind of chrome real slot UIs
// spend their polish budget on) plus bespoke center iconography and its
// own color identity, ascending in richness from TEN (low pay) to
// VAULTLINE_EMBLEM (top pay), with WILD and SCATTER visually distinct
// from the paying set.

import { Texture } from "pixi.js";
import type { SlotSymbolId } from "@/lib/types";

const SIZE = 256;

function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = SIZE;
  c.height = SIZE;
  return c;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Shared bevelled-metal plaque every symbol sits on. `tint` drives the border metal color family. */
function drawPlaque(ctx: CanvasRenderingContext2D, tintA: string, tintB: string, glassTint: string) {
  const pad = 10;
  const r = 26;
  const w = SIZE - pad * 2;
  const h = SIZE - pad * 2;

  // Drop shadow
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  roundRectPath(ctx, pad, pad, w, h, r);
  ctx.fillStyle = "#0b0f18";
  ctx.fill();
  ctx.restore();

  // Metal border gradient
  const borderGrad = ctx.createLinearGradient(pad, pad, pad, pad + h);
  borderGrad.addColorStop(0, tintA);
  borderGrad.addColorStop(0.5, tintB);
  borderGrad.addColorStop(1, tintA);
  roundRectPath(ctx, pad, pad, w, h, r);
  ctx.fillStyle = borderGrad;
  ctx.fill();

  // Inner face (darker glass panel)
  const innerPad = 7;
  const faceGrad = ctx.createLinearGradient(0, pad + innerPad, 0, pad + h - innerPad);
  faceGrad.addColorStop(0, "#161c2c");
  faceGrad.addColorStop(0.55, "#0d1120");
  faceGrad.addColorStop(1, "#080a12");
  roundRectPath(ctx, pad + innerPad, pad + innerPad, w - innerPad * 2, h - innerPad * 2, r - 8);
  ctx.fillStyle = faceGrad;
  ctx.fill();

  // Top glass highlight sweep
  ctx.save();
  roundRectPath(ctx, pad + innerPad, pad + innerPad, w - innerPad * 2, h - innerPad * 2, r - 8);
  ctx.clip();
  const sheen = ctx.createLinearGradient(0, pad, 0, pad + h * 0.55);
  sheen.addColorStop(0, glassTint);
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(pad, pad, w, h * 0.6);
  ctx.restore();

  // Outer rim highlight (thin bright edge at top)
  roundRectPath(ctx, pad, pad, w, h, r);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.stroke();

  return { cx: SIZE / 2, cy: SIZE / 2, w, h, pad };
}

function glowText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, colorA: string, colorB: string) {
  ctx.save();
  ctx.font = `800 ${size}px Georgia, "Times New Roman", serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = colorA;
  ctx.shadowBlur = size * 0.35;
  const grad = ctx.createLinearGradient(x, y - size / 2, x, y + size / 2);
  grad.addColorStop(0, colorB);
  grad.addColorStop(0.5, colorA);
  grad.addColorStop(1, colorB);
  ctx.fillStyle = grad;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
  ctx.lineWidth = size * 0.02;
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.strokeText(text, x, y);
  ctx.restore();
}

function drawFacetedGem(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, colorA: string, colorB: string, colorC: string) {
  ctx.save();
  ctx.translate(cx, cy);
  const top = -r;
  const girdleY = -r * 0.15;
  // Top table
  ctx.beginPath();
  ctx.moveTo(-r * 0.35, top + r * 0.15);
  ctx.lineTo(r * 0.35, top + r * 0.15);
  ctx.lineTo(r * 0.85, girdleY);
  ctx.lineTo(-r * 0.85, girdleY);
  ctx.closePath();
  const tableGrad = ctx.createLinearGradient(0, top, 0, girdleY);
  tableGrad.addColorStop(0, colorC);
  tableGrad.addColorStop(1, colorA);
  ctx.fillStyle = tableGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Left/right upper facets
  [-1, 1].forEach((side) => {
    ctx.beginPath();
    ctx.moveTo(side * r * 0.35, top + r * 0.15);
    ctx.lineTo(side * r * 0.85, girdleY);
    ctx.lineTo(side * r, girdleY);
    ctx.closePath();
    ctx.fillStyle = side < 0 ? colorB : colorA;
    ctx.fill();
    ctx.stroke();
  });

  // Pavilion (lower point) facets
  const pavPoint = r * 0.9;
  [-1, -0.33, 0.33, 1].forEach((side, i) => {
    ctx.beginPath();
    ctx.moveTo(side * r * 0.85, girdleY);
    ctx.lineTo(side * r * 0.28, girdleY);
    ctx.lineTo(0, pavPoint);
    ctx.closePath();
    ctx.fillStyle = i % 2 === 0 ? colorA : colorB;
    ctx.globalAlpha = 0.92;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();
  });

  ctx.restore();
}

function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.quadraticCurveTo(r * 0.15, -r * 0.15, r, 0);
  ctx.quadraticCurveTo(r * 0.15, r * 0.15, 0, r);
  ctx.quadraticCurveTo(-r * 0.15, r * 0.15, -r, 0);
  ctx.quadraticCurveTo(-r * 0.15, -r * 0.15, 0, -r);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ---- Per-symbol renderers ----

const RANK_STYLES: Record<string, { label: string; a: string; b: string; c: string }> = {
  TEN: { label: "10", a: "#6b7280", b: "#9ca3af", c: "#d1d5db" },
  JACK: { label: "J", a: "#2d6a5f", b: "#3f9c8a", c: "#6fd8c2" },
  QUEEN: { label: "Q", a: "#8a2d5c", b: "#c23f85", c: "#f27ab7" },
  KING: { label: "K", a: "#2d4a8a", b: "#3f6bc2", c: "#7fa8f2" },
  ACE: { label: "A", a: "#8a5a2d", b: "#c28a3f", c: "#f2c47a" },
};

function renderRankSymbol(ctx: CanvasRenderingContext2D, id: keyof typeof RANK_STYLES) {
  const s = RANK_STYLES[id];
  const { cx, cy } = drawPlaque(ctx, "#3a4152", "#8b96ad", "rgba(255,255,255,0.18)");
  // Small gem accent above the letter
  drawFacetedGem(ctx, cx, cy - 62, 20, s.a, s.b, s.c);
  glowText(ctx, s.label, cx, cy + 22, 118, s.b, s.c);
  // Bottom ribbon
  ctx.save();
  ctx.translate(cx, cy + 84);
  ctx.fillStyle = s.a;
  ctx.fillRect(-58, -8, 116, 16);
  ctx.fillStyle = s.b;
  ctx.fillRect(-58, -8, 116, 5);
  ctx.restore();
}

function renderCoinStack(ctx: CanvasRenderingContext2D) {
  const { cx, cy } = drawPlaque(ctx, "#4a3315", "#caa14a", "rgba(255,255,255,0.2)");
  const coinColors = ["#8a6a2a", "#caa14a", "#f2d98a"];
  for (let i = 0; i < 5; i++) {
    const y = cy + 58 - i * 16;
    ctx.save();
    ctx.translate(cx, y);
    ctx.beginPath();
    ctx.ellipse(0, 0, 54, 16, 0, 0, Math.PI * 2);
    const g = ctx.createLinearGradient(-54, 0, 54, 0);
    g.addColorStop(0, coinColors[0]);
    g.addColorStop(0.5, coinColors[2]);
    g.addColorStop(1, coinColors[0]);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, -3, 40, 9, 0, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
  // top coin face with $ emblem
  ctx.save();
  ctx.translate(cx, cy - 22);
  ctx.beginPath();
  ctx.ellipse(0, 0, 54, 30, 0, 0, Math.PI * 2);
  const topG = ctx.createRadialGradient(-14, -12, 6, 0, 0, 54);
  topG.addColorStop(0, "#fff2c9");
  topG.addColorStop(0.45, coinColors[2]);
  topG.addColorStop(1, coinColors[0]);
  ctx.fillStyle = topG;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 2;
  ctx.stroke();
  glowText(ctx, "$", 0, 3, 40, "#caa14a", "#fff2c9");
  ctx.restore();
}

function renderLaserDevice(ctx: CanvasRenderingContext2D) {
  const { cx, cy } = drawPlaque(ctx, "#0f3b3a", "#1ea89e", "rgba(153,255,240,0.22)");
  // Device housing
  ctx.save();
  ctx.translate(cx, cy);
  const bodyGrad = ctx.createLinearGradient(-50, -30, 50, 40);
  bodyGrad.addColorStop(0, "#233045");
  bodyGrad.addColorStop(0.5, "#3a4d6b");
  bodyGrad.addColorStop(1, "#1a2536");
  roundRectPath(ctx, -46, -40, 92, 60, 14);
  ctx.fillStyle = bodyGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(45,191,176,0.7)";
  ctx.lineWidth = 2;
  ctx.stroke();
  // Lens
  ctx.beginPath();
  ctx.arc(0, -10, 20, 0, Math.PI * 2);
  const lensGrad = ctx.createRadialGradient(-5, -15, 2, 0, -10, 20);
  lensGrad.addColorStop(0, "#e6fffb");
  lensGrad.addColorStop(0.4, "#2dbfb0");
  lensGrad.addColorStop(1, "#0a3a36");
  ctx.fillStyle = lensGrad;
  ctx.fill();
  ctx.strokeStyle = "#8ef2e6";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Vents
  ctx.strokeStyle = "rgba(153,255,240,0.5)";
  ctx.lineWidth = 3;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(-32 + i * 12, 8);
    ctx.lineTo(-32 + i * 12, 18);
    ctx.stroke();
  }
  // Laser beam shooting down
  const beamGrad = ctx.createLinearGradient(0, -10, 0, 92);
  beamGrad.addColorStop(0, "rgba(150,255,235,0.95)");
  beamGrad.addColorStop(1, "rgba(45,191,176,0)");
  ctx.fillStyle = beamGrad;
  ctx.beginPath();
  ctx.moveTo(-6, -10);
  ctx.lineTo(6, -10);
  ctx.lineTo(16, 92);
  ctx.lineTo(-16, 92);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function renderVaultKey(ctx: CanvasRenderingContext2D) {
  const { cx, cy } = drawPlaque(ctx, "#5c3d12", "#e0ab4a", "rgba(255,235,180,0.25)");
  ctx.save();
  ctx.translate(cx, cy - 4);
  ctx.rotate(-0.55);
  const goldGrad = ctx.createLinearGradient(-40, -60, 40, 60);
  goldGrad.addColorStop(0, "#7a5417");
  goldGrad.addColorStop(0.5, "#f2c766");
  goldGrad.addColorStop(1, "#a5751f");

  // Bow (head) — ornate ring
  ctx.beginPath();
  ctx.arc(0, -44, 26, 0, Math.PI * 2);
  ctx.arc(0, -44, 13, 0, Math.PI * 2, true);
  ctx.fillStyle = goldGrad;
  ctx.fill("evenodd");
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // gem in bow
  drawFacetedGem(ctx, 0, -44, 9, "#0f6b63", "#2dbfb0", "#bdfff5");

  // Shaft
  roundRectPath(ctx, -6, -20, 12, 68, 4);
  ctx.fillStyle = goldGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.stroke();

  // Teeth (bit)
  ctx.beginPath();
  ctx.moveTo(-6, 30);
  ctx.lineTo(-6, 48);
  ctx.lineTo(6, 48);
  ctx.lineTo(6, 42);
  ctx.lineTo(18, 42);
  ctx.lineTo(18, 30);
  ctx.lineTo(6, 30);
  ctx.lineTo(6, 36);
  ctx.lineTo(-6, 36);
  ctx.closePath();
  ctx.fillStyle = goldGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.stroke();

  // Highlight sweep along shaft
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = "#fff3d0";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-2, -18);
  ctx.lineTo(-2, 44);
  ctx.stroke();
  ctx.restore();
}

function renderDiamond(ctx: CanvasRenderingContext2D) {
  const { cx, cy } = drawPlaque(ctx, "#1a3a52", "#5ec9e8", "rgba(210,245,255,0.3)");
  drawFacetedGem(ctx, cx, cy + 8, 66, "#1e88b8", "#6fd4f2", "#eafcff");
  // Sparkle accents
  sparkle(ctx, cx - 62, cy - 52, 10, "#eafcff", 0.9);
  sparkle(ctx, cx + 58, cy - 40, 7, "#bfeeff", 0.8);
  sparkle(ctx, cx + 44, cy + 66, 6, "#eafcff", 0.7);
  sparkle(ctx, cx - 50, cy + 60, 5, "#bfeeff", 0.6);
}

function renderGoldBar(ctx: CanvasRenderingContext2D) {
  const { cx, cy } = drawPlaque(ctx, "#5c4713", "#e8b73f", "rgba(255,240,190,0.25)");
  ctx.save();
  ctx.translate(cx, cy + 6);
  // Top trapezoid face (3D bar)
  const topGrad = ctx.createLinearGradient(-70, -30, 70, 20);
  topGrad.addColorStop(0, "#8a6a1f");
  topGrad.addColorStop(0.5, "#f7dd8a");
  topGrad.addColorStop(1, "#a5801f");
  ctx.beginPath();
  ctx.moveTo(-70, 10);
  ctx.lineTo(-50, -22);
  ctx.lineTo(50, -22);
  ctx.lineTo(70, 10);
  ctx.closePath();
  ctx.fillStyle = topGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 2;
  ctx.stroke();
  // Front face
  const frontGrad = ctx.createLinearGradient(0, 10, 0, 56);
  frontGrad.addColorStop(0, "#c99a2f");
  frontGrad.addColorStop(1, "#7a5c17");
  ctx.beginPath();
  ctx.moveTo(-70, 10);
  ctx.lineTo(70, 10);
  ctx.lineTo(58, 50);
  ctx.lineTo(-58, 50);
  ctx.closePath();
  ctx.fillStyle = frontGrad;
  ctx.fill();
  ctx.stroke();
  // Emblem stamp
  ctx.save();
  ctx.translate(0, 28);
  ctx.beginPath();
  ctx.arc(0, 0, 15, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(60,40,5,0.7)";
  ctx.lineWidth = 2;
  ctx.stroke();
  glowText(ctx, "VL", 0, 2, 16, "#5c4713", "#fff3cf");
  ctx.restore();
  // Sheen sweep across top
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-70, 10);
  ctx.lineTo(-50, -22);
  ctx.lineTo(50, -22);
  ctx.lineTo(70, 10);
  ctx.closePath();
  ctx.clip();
  const sheen = ctx.createLinearGradient(-70, -22, 20, 10);
  sheen.addColorStop(0, "rgba(255,255,255,0)");
  sheen.addColorStop(0.5, "rgba(255,255,255,0.55)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(-70, -22, 140, 32);
  ctx.restore();
  ctx.restore();
}

function renderVaultlineEmblem(ctx: CanvasRenderingContext2D) {
  const { cx, cy } = drawPlaque(ctx, "#4a2d0f", "#d4af37", "rgba(255,235,170,0.3)");
  ctx.save();
  ctx.translate(cx, cy);
  // Radiant rays behind
  ctx.save();
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 12; i++) {
    ctx.rotate((Math.PI * 2) / 12);
    ctx.fillStyle = i % 2 === 0 ? "#f2d98a" : "#2dbfb0";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-6, -92);
    ctx.lineTo(6, -92);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // Medallion
  const medGrad = ctx.createRadialGradient(-10, -14, 6, 0, 0, 58);
  medGrad.addColorStop(0, "#fff2c9");
  medGrad.addColorStop(0.4, "#e8c15a");
  medGrad.addColorStop(1, "#8a641f");
  ctx.beginPath();
  ctx.arc(0, 0, 58, 0, Math.PI * 2);
  ctx.fillStyle = medGrad;
  ctx.fill();
  ctx.strokeStyle = "#2dbfb0";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 46, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(45,20,5,0.55)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Vault door bolts ring
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI * 2 * i) / 8;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 40, Math.sin(a) * 40, 3.4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(45,20,5,0.6)";
    ctx.fill();
  }
  glowText(ctx, "VL", 0, 4, 44, "#5c4713", "#fff8e0");
  ctx.restore();
}

function renderWild(ctx: CanvasRenderingContext2D) {
  const { cx, cy } = drawPlaque(ctx, "#0f3b3a", "#2dbfb0", "rgba(160,255,240,0.28)");
  ctx.save();
  ctx.translate(cx, cy);
  // Energy ring
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(0, 0, 70 - i * 14, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(45,191,176,${0.5 - i * 0.12})`;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  // Jagged energy burst behind text
  ctx.save();
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = "#1ea89e";
  ctx.beginPath();
  const spikes = 10;
  for (let i = 0; i < spikes * 2; i++) {
    const a = (Math.PI * i) / spikes;
    const r = i % 2 === 0 ? 78 : 46;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  glowText(ctx, "WILD", 0, 6, 40, "#003d38", "#e6fffb");
  ctx.restore();
}

function renderScatter(ctx: CanvasRenderingContext2D) {
  const { cx, cy } = drawPlaque(ctx, "#3a2a10", "#d4af37", "rgba(255,235,170,0.28)");
  ctx.save();
  ctx.translate(cx, cy);
  // Outer vault ring
  const ringGrad = ctx.createRadialGradient(-10, -14, 10, 0, 0, 76);
  ringGrad.addColorStop(0, "#f2d98a");
  ringGrad.addColorStop(0.55, "#b5862c");
  ringGrad.addColorStop(1, "#5c4415");
  ctx.beginPath();
  ctx.arc(0, 0, 76, 0, Math.PI * 2);
  ctx.fillStyle = ringGrad;
  ctx.fill();
  ctx.strokeStyle = "#2dbfb0";
  ctx.lineWidth = 3;
  ctx.stroke();

  // Bolt circle
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI * 2 * i) / 10;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 62, Math.sin(a) * 62, 4.2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(30,20,5,0.7)";
    ctx.fill();
  }

  // Inner door face
  ctx.beginPath();
  ctx.arc(0, 0, 48, 0, Math.PI * 2);
  ctx.fillStyle = "#3a2a10";
  ctx.fill();
  ctx.strokeStyle = "rgba(212,175,55,0.6)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Spinning wheel handle (spokes)
  ctx.save();
  ctx.rotate(0.35);
  for (let i = 0; i < 6; i++) {
    ctx.rotate(Math.PI / 3);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -40);
    ctx.strokeStyle = "#e8c15a";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, 13, 0, Math.PI * 2);
  const hubGrad = ctx.createRadialGradient(-3, -4, 1, 0, 0, 13);
  hubGrad.addColorStop(0, "#fff2c9");
  hubGrad.addColorStop(1, "#8a641f");
  ctx.fillStyle = hubGrad;
  ctx.fill();
  ctx.restore();
  ctx.restore();
}

const RENDERERS: Record<SlotSymbolId, (ctx: CanvasRenderingContext2D) => void> = {
  TEN: (ctx) => renderRankSymbol(ctx, "TEN"),
  JACK: (ctx) => renderRankSymbol(ctx, "JACK"),
  QUEEN: (ctx) => renderRankSymbol(ctx, "QUEEN"),
  KING: (ctx) => renderRankSymbol(ctx, "KING"),
  ACE: (ctx) => renderRankSymbol(ctx, "ACE"),
  COIN_STACK: renderCoinStack,
  LASER_DEVICE: renderLaserDevice,
  VAULT_KEY: renderVaultKey,
  DIAMOND: renderDiamond,
  GOLD_BAR: renderGoldBar,
  VAULTLINE_EMBLEM: renderVaultlineEmblem,
  WILD: renderWild,
  SCATTER: renderScatter,
};

export const ALL_SYMBOL_IDS: SlotSymbolId[] = [
  "TEN",
  "JACK",
  "QUEEN",
  "KING",
  "ACE",
  "COIN_STACK",
  "LASER_DEVICE",
  "VAULT_KEY",
  "DIAMOND",
  "GOLD_BAR",
  "VAULTLINE_EMBLEM",
  "WILD",
  "SCATTER",
];

/** Builds every symbol texture once. Call after PIXI is ready (client-only, needs `document`). */
export function buildSymbolTextures(): Record<SlotSymbolId, Texture> {
  const out = {} as Record<SlotSymbolId, Texture>;
  for (const id of ALL_SYMBOL_IDS) {
    const canvas = makeCanvas();
    const ctx = canvas.getContext("2d")!;
    RENDERERS[id](ctx);
    out[id] = Texture.from(canvas);
  }
  return out;
}

/**
 * Renders one symbol to a plain PNG data URL, for places that need the art
 * as a regular <img> rather than a PIXI.Texture — e.g. the paytable sheet,
 * which is DOM/React, not canvas. Reuses the exact same RENDERERS used by
 * buildSymbolTextures, so the paytable art matches the in-game reels
 * pixel-for-pixel.
 */
export function renderSymbolToDataURL(id: SlotSymbolId): string {
  const canvas = makeCanvas();
  const ctx = canvas.getContext("2d")!;
  RENDERERS[id](ctx);
  return canvas.toDataURL("image/png");
}
