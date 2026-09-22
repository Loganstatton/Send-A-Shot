// Vault Breaker symbol art. No image-generation tool is available in this
// environment, so there is no photographic/illustrated art here — instead
// every symbol is a layered, hand-authored 2D-canvas composition (multiple
// gradients, shadows, highlight sweeps, metallic bevels) rendered ONCE per
// symbol to an offscreen canvas and uploaded to the GPU as a single
// PIXI.Texture, reused by every sprite that shows that symbol (the "pool,
// don't recreate" performance rule from the brief).
//
// IMPORTANT (V2): earlier symbols each sat on a bordered "plaque" — a
// bevelled rounded-rect frame around every icon. That is exactly what made
// the reels read as "a grid of square buttons" instead of a real slot. This
// version draws NO per-symbol background, border or frame at all. Each
// symbol is transparent canvas + a soft ambient color glow (matching its
// identity) + a contact shadow, so it reads as an object floating inside
// the reel strip — the reel column itself (ReelStrip/vaultBackdrop) is what
// supplies the surrounding "machine" surface, never the symbol art.
// Symbols are also rendered to fill far more of their canvas than before,
// per the brief's "significantly larger" note.

import { Texture } from "pixi.js";
import type { SlotSymbolId } from "@/lib/types";

const SIZE = 300;

function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = SIZE;
  c.height = SIZE;
  return c;
}

/** Soft ambient glow halo behind the icon — replaces the old bordered plaque. No hard edges, no rectangle. */
function symbolGlow(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string, strength = 0.4) {
  ctx.save();
  const g = ctx.createRadialGradient(cx, cy, 8, cx, cy, SIZE * 0.46);
  g.addColorStop(0, color.replace("ALPHA", String(strength)));
  g.addColorStop(1, color.replace("ALPHA", "0"));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.restore();
}

/** Contact shadow ellipse — gives the floating icon weight/grounding without a border. */
function contactShadow(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number) {
  ctx.save();
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
  g.addColorStop(0, "rgba(0,0,0,0.45)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, rx * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function glowText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, colorA: string, colorB: string) {
  ctx.save();
  ctx.font = `800 ${size}px Georgia, "Times New Roman", serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = colorA;
  ctx.shadowBlur = size * 0.4;
  const grad = ctx.createLinearGradient(x, y - size / 2, x, y + size / 2);
  grad.addColorStop(0, colorB);
  grad.addColorStop(0.5, colorA);
  grad.addColorStop(1, colorB);
  ctx.fillStyle = grad;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
  ctx.lineWidth = size * 0.03;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.strokeText(text, x, y);
  ctx.restore();
}

function drawFacetedGem(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, colorA: string, colorB: string, colorC: string) {
  ctx.save();
  ctx.translate(cx, cy);
  const top = -r;
  const girdleY = -r * 0.15;
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

// ---- Per-symbol renderers (all centered on cx,cy = SIZE/2, no enclosing frame) ----

const RANK_STYLES: Record<string, { label: string; a: string; b: string; c: string; glow: string }> = {
  TEN: { label: "10", a: "#6b7280", b: "#9ca3af", c: "#e5e7eb", glow: "rgba(156,163,175,ALPHA)" },
  JACK: { label: "J", a: "#1f6a5a", b: "#3f9c8a", c: "#8ff2d8", glow: "rgba(63,156,138,ALPHA)" },
  QUEEN: { label: "Q", a: "#8a2d5c", b: "#c23f85", c: "#f7a8d6", glow: "rgba(194,63,133,ALPHA)" },
  KING: { label: "K", a: "#2d4a8a", b: "#3f6bc2", c: "#9ec2f7", glow: "rgba(63,107,194,ALPHA)" },
  ACE: { label: "A", a: "#8a5a2d", b: "#c28a3f", c: "#f7d29a", glow: "rgba(194,138,63,ALPHA)" },
};

function renderRankSymbol(ctx: CanvasRenderingContext2D, id: keyof typeof RANK_STYLES) {
  const s = RANK_STYLES[id];
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  symbolGlow(ctx, cx, cy, s.glow, 0.32);
  contactShadow(ctx, cx, cy + 92, 78);
  drawFacetedGem(ctx, cx, cy - 82, 24, s.a, s.b, s.c);
  glowText(ctx, s.label, cx, cy + 26, 150, s.b, s.c);
  ctx.save();
  ctx.translate(cx, cy + 108);
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = s.a;
  ctx.fillRect(-70, -6, 140, 12);
  ctx.fillStyle = s.b;
  ctx.fillRect(-70, -6, 140, 4);
  ctx.restore();
}

function renderCoinStack(ctx: CanvasRenderingContext2D) {
  const cx = SIZE / 2;
  const cy = SIZE / 2 + 6;
  symbolGlow(ctx, cx, cy, "rgba(212,175,55,ALPHA)", 0.4);
  contactShadow(ctx, cx, cy + 96, 88);
  const coinColors = ["#8a6a2a", "#caa14a", "#f2d98a"];
  for (let i = 0; i < 5; i++) {
    const y = cy + 68 - i * 19;
    ctx.save();
    ctx.translate(cx, y);
    ctx.beginPath();
    ctx.ellipse(0, 0, 64, 19, 0, 0, Math.PI * 2);
    const g = ctx.createLinearGradient(-64, 0, 64, 0);
    g.addColorStop(0, coinColors[0]);
    g.addColorStop(0.5, coinColors[2]);
    g.addColorStop(1, coinColors[0]);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, -3.5, 48, 11, 0, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
  ctx.save();
  ctx.translate(cx, cy - 26);
  ctx.beginPath();
  ctx.ellipse(0, 0, 64, 36, 0, 0, Math.PI * 2);
  const topG = ctx.createRadialGradient(-16, -14, 6, 0, 0, 64);
  topG.addColorStop(0, "#fff2c9");
  topG.addColorStop(0.45, coinColors[2]);
  topG.addColorStop(1, coinColors[0]);
  ctx.fillStyle = topG;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 2;
  ctx.stroke();
  glowText(ctx, "$", 0, 3, 48, "#caa14a", "#fff2c9");
  ctx.restore();
}

function renderLaserDevice(ctx: CanvasRenderingContext2D) {
  const cx = SIZE / 2;
  const cy = SIZE / 2 - 6;
  symbolGlow(ctx, cx, cy, "rgba(45,191,176,ALPHA)", 0.42);
  contactShadow(ctx, cx, cy + 86, 78);
  ctx.save();
  ctx.translate(cx, cy);
  const bodyGrad = ctx.createLinearGradient(-58, -34, 58, 46);
  bodyGrad.addColorStop(0, "#233045");
  bodyGrad.addColorStop(0.5, "#3a4d6b");
  bodyGrad.addColorStop(1, "#1a2536");
  const r1 = 16;
  ctx.beginPath();
  ctx.moveTo(-52 + r1, -46);
  ctx.arcTo(54, -46, 54, 68, r1);
  ctx.arcTo(54, 68, -54, 68, r1);
  ctx.arcTo(-54, 68, -54, -46, r1);
  ctx.arcTo(-54, -46, 54, -46, r1);
  ctx.closePath();
  ctx.fillStyle = bodyGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(45,191,176,0.75)";
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -12, 24, 0, Math.PI * 2);
  const lensGrad = ctx.createRadialGradient(-6, -18, 2, 0, -12, 24);
  lensGrad.addColorStop(0, "#e6fffb");
  lensGrad.addColorStop(0.4, "#2dbfb0");
  lensGrad.addColorStop(1, "#0a3a36");
  ctx.fillStyle = lensGrad;
  ctx.fill();
  ctx.strokeStyle = "#8ef2e6";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.strokeStyle = "rgba(153,255,240,0.5)";
  ctx.lineWidth = 3.5;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(-36 + i * 14, 12);
    ctx.lineTo(-36 + i * 14, 24);
    ctx.stroke();
  }
  const beamGrad = ctx.createLinearGradient(0, -12, 0, 110);
  beamGrad.addColorStop(0, "rgba(150,255,235,0.95)");
  beamGrad.addColorStop(1, "rgba(45,191,176,0)");
  ctx.fillStyle = beamGrad;
  ctx.beginPath();
  ctx.moveTo(-7, -12);
  ctx.lineTo(7, -12);
  ctx.lineTo(19, 110);
  ctx.lineTo(-19, 110);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function renderVaultKey(ctx: CanvasRenderingContext2D) {
  const cx = SIZE / 2;
  const cy = SIZE / 2 - 2;
  symbolGlow(ctx, cx, cy, "rgba(212,175,55,ALPHA)", 0.4);
  contactShadow(ctx, cx, cy + 96, 68);
  ctx.save();
  ctx.translate(cx, cy - 4);
  ctx.rotate(-0.55);
  const goldGrad = ctx.createLinearGradient(-46, -70, 46, 70);
  goldGrad.addColorStop(0, "#7a5417");
  goldGrad.addColorStop(0.5, "#f2c766");
  goldGrad.addColorStop(1, "#a5751f");

  ctx.beginPath();
  ctx.arc(0, -52, 30, 0, Math.PI * 2);
  ctx.arc(0, -52, 15, 0, Math.PI * 2, true);
  ctx.fillStyle = goldGrad;
  ctx.fill("evenodd");
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  drawFacetedGem(ctx, 0, -52, 11, "#0f6b63", "#2dbfb0", "#bdfff5");

  ctx.beginPath();
  ctx.moveTo(-7, -24);
  ctx.lineTo(7, -24);
  ctx.lineTo(7, 46);
  ctx.lineTo(-7, 46);
  ctx.closePath();
  ctx.fillStyle = goldGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-7, 34);
  ctx.lineTo(-7, 56);
  ctx.lineTo(7, 56);
  ctx.lineTo(7, 48);
  ctx.lineTo(21, 48);
  ctx.lineTo(21, 34);
  ctx.lineTo(7, 34);
  ctx.lineTo(7, 42);
  ctx.lineTo(-7, 42);
  ctx.closePath();
  ctx.fillStyle = goldGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.stroke();

  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = "#fff3d0";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-2, -22);
  ctx.lineTo(-2, 50);
  ctx.stroke();
  ctx.restore();
}

function renderDiamond(ctx: CanvasRenderingContext2D) {
  const cx = SIZE / 2;
  const cy = SIZE / 2 + 4;
  symbolGlow(ctx, cx, cy, "rgba(94,201,232,ALPHA)", 0.46);
  contactShadow(ctx, cx, cy + 92, 84);
  drawFacetedGem(ctx, cx, cy + 6, 84, "#1e88b8", "#6fd4f2", "#eafcff");
  sparkle(ctx, cx - 78, cy - 66, 12, "#eafcff", 0.9);
  sparkle(ctx, cx + 74, cy - 50, 9, "#bfeeff", 0.8);
  sparkle(ctx, cx + 56, cy + 82, 7, "#eafcff", 0.7);
  sparkle(ctx, cx - 64, cy + 76, 6, "#bfeeff", 0.6);
}

function renderGoldBar(ctx: CanvasRenderingContext2D) {
  const cx = SIZE / 2;
  const cy = SIZE / 2 + 8;
  symbolGlow(ctx, cx, cy, "rgba(232,183,63,ALPHA)", 0.42);
  contactShadow(ctx, cx, cy + 66, 92);
  ctx.save();
  ctx.translate(cx, cy + 6);
  const topGrad = ctx.createLinearGradient(-88, -38, 88, 24);
  topGrad.addColorStop(0, "#8a6a1f");
  topGrad.addColorStop(0.5, "#f7dd8a");
  topGrad.addColorStop(1, "#a5801f");
  ctx.beginPath();
  ctx.moveTo(-88, 12);
  ctx.lineTo(-62, -28);
  ctx.lineTo(62, -28);
  ctx.lineTo(88, 12);
  ctx.closePath();
  ctx.fillStyle = topGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 2;
  ctx.stroke();
  const frontGrad = ctx.createLinearGradient(0, 12, 0, 68);
  frontGrad.addColorStop(0, "#c99a2f");
  frontGrad.addColorStop(1, "#7a5c17");
  ctx.beginPath();
  ctx.moveTo(-88, 12);
  ctx.lineTo(88, 12);
  ctx.lineTo(72, 62);
  ctx.lineTo(-72, 62);
  ctx.closePath();
  ctx.fillStyle = frontGrad;
  ctx.fill();
  ctx.stroke();
  ctx.save();
  ctx.translate(0, 36);
  ctx.beginPath();
  ctx.arc(0, 0, 19, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(60,40,5,0.7)";
  ctx.lineWidth = 2;
  ctx.stroke();
  glowText(ctx, "VL", 0, 2, 20, "#5c4713", "#fff3cf");
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-88, 12);
  ctx.lineTo(-62, -28);
  ctx.lineTo(62, -28);
  ctx.lineTo(88, 12);
  ctx.closePath();
  ctx.clip();
  const sheen = ctx.createLinearGradient(-88, -28, 30, 12);
  sheen.addColorStop(0, "rgba(255,255,255,0)");
  sheen.addColorStop(0.5, "rgba(255,255,255,0.6)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(-88, -28, 176, 40);
  ctx.restore();
  ctx.restore();
}

function renderVaultlineEmblem(ctx: CanvasRenderingContext2D) {
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  symbolGlow(ctx, cx, cy, "rgba(212,175,55,ALPHA)", 0.5);
  contactShadow(ctx, cx, cy + 96, 84);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.save();
  ctx.globalAlpha = 0.32;
  for (let i = 0; i < 12; i++) {
    ctx.rotate((Math.PI * 2) / 12);
    ctx.fillStyle = i % 2 === 0 ? "#f2d98a" : "#2dbfb0";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-7, -108);
    ctx.lineTo(7, -108);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  const medGrad = ctx.createRadialGradient(-12, -16, 6, 0, 0, 70);
  medGrad.addColorStop(0, "#fff2c9");
  medGrad.addColorStop(0.4, "#e8c15a");
  medGrad.addColorStop(1, "#8a641f");
  ctx.beginPath();
  ctx.arc(0, 0, 70, 0, Math.PI * 2);
  ctx.fillStyle = medGrad;
  ctx.fill();
  ctx.strokeStyle = "#2dbfb0";
  ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 55, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(45,20,5,0.55)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI * 2 * i) / 8;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 48, Math.sin(a) * 48, 4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(45,20,5,0.6)";
    ctx.fill();
  }
  glowText(ctx, "VL", 0, 4, 52, "#5c4713", "#fff8e0");
  ctx.restore();
}

function renderWild(ctx: CanvasRenderingContext2D) {
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  symbolGlow(ctx, cx, cy, "rgba(45,191,176,ALPHA)", 0.5);
  contactShadow(ctx, cx, cy + 96, 84);
  ctx.save();
  ctx.translate(cx, cy);
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(0, 0, 84 - i * 16, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(45,191,176,${0.5 - i * 0.12})`;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.save();
  ctx.globalAlpha = 0.72;
  ctx.fillStyle = "#1ea89e";
  ctx.beginPath();
  const spikes = 10;
  for (let i = 0; i < spikes * 2; i++) {
    const a = (Math.PI * i) / spikes;
    const r = i % 2 === 0 ? 92 : 54;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  glowText(ctx, "WILD", 0, 6, 48, "#003d38", "#e6fffb");
  ctx.restore();
}

function renderScatter(ctx: CanvasRenderingContext2D) {
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  symbolGlow(ctx, cx, cy, "rgba(212,175,55,ALPHA)", 0.5);
  contactShadow(ctx, cx, cy + 98, 90);
  ctx.save();
  ctx.translate(cx, cy);
  const ringGrad = ctx.createRadialGradient(-12, -16, 10, 0, 0, 90);
  ringGrad.addColorStop(0, "#f2d98a");
  ringGrad.addColorStop(0.55, "#b5862c");
  ringGrad.addColorStop(1, "#5c4415");
  ctx.beginPath();
  ctx.arc(0, 0, 90, 0, Math.PI * 2);
  ctx.fillStyle = ringGrad;
  ctx.fill();
  ctx.strokeStyle = "#2dbfb0";
  ctx.lineWidth = 3.5;
  ctx.stroke();

  for (let i = 0; i < 10; i++) {
    const a = (Math.PI * 2 * i) / 10;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 74, Math.sin(a) * 74, 5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(30,20,5,0.7)";
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(0, 0, 57, 0, Math.PI * 2);
  ctx.fillStyle = "#3a2a10";
  ctx.fill();
  ctx.strokeStyle = "rgba(212,175,55,0.6)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.save();
  ctx.rotate(0.35);
  for (let i = 0; i < 6; i++) {
    ctx.rotate(Math.PI / 3);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -47);
    ctx.strokeStyle = "#e8c15a";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, 15, 0, Math.PI * 2);
  const hubGrad = ctx.createRadialGradient(-3, -4, 1, 0, 0, 15);
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
