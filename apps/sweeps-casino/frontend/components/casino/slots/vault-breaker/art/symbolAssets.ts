// Vault Breaker symbol art loader — REBUILD (V4), real-art swap (V5).
//
// ART CONTRACT (read this before touching this file): every symbol maps to
// exactly one texture URL, resolved in this ONE place. Swapping art later
// means changing an entry in `SYMBOL_ART_URLS` below — nothing in the
// renderer (ReelStrip/SlotRenderer) ever hardcodes a path, so that swap
// requires zero renderer code changes.
//
// CURRENT STATE: 11 of the 13 backend symbol IDs (see
// backend/.../vault-breaker/symbols.ts) now use real production art —
// alpha-verified, mostly-transparent 1024x1024 renders — committed at
// public/games/vault-breaker/real/symbols/<ID>.webp. `LASER_DEVICE` has no
// real art yet (a real gap, already flagged) and stays on its flat
// placeholder shape at
// public/games/vault-breaker/placeholder/symbols/LASER_DEVICE.png — we do
// not invent new art for it. What THIS pass does do (see
// buildLaserDevicePlaceholderTexture below) is a deliberately modest
// least-bad treatment so it stops reading as "an asset from a different
// game" sitting among the 11 real illustrated symbols: the flat red
// diamond-outline PNG is recolored in-place with the same
// gold-highlight-to-teal-shadow metallic lighting direction the real art
// uses (a top-lit bevel, matching e.g. VAULT_KEY/DIAMOND), then its overall
// alpha is knocked down slightly so it also reads as visually recessive —
// "the one symbol still pending", not a clashing foreign asset. It is
// still honestly a placeholder (same flat vector shape, no new
// illustration), just no longer color-clashing.
//
// Known art note: WILD.webp has a soft-edged dark teal badge/card shape
// baked into ~70% of its canvas (a feathered vignette, not a hard box) —
// used as provided; do not crop/mask it programmatically.
import { Assets, Texture } from "pixi.js";
import type { SlotSymbolId } from "@/lib/types";

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

const REAL_SYMBOL_BASE = "/games/vault-breaker/real/symbols";
const PLACEHOLDER_SYMBOL_BASE = "/games/vault-breaker/placeholder/symbols";

/**
 * One clean symbolId -> URL mapping, in one place. Every ID here is real
 * production art except LASER_DEVICE, which has no real asset yet and stays
 * on its placeholder. Swapping in LASER_DEVICE's real art later is a
 * one-line change to this map — nothing else in the engine changes.
 */
const SYMBOL_ART_URLS: Record<SlotSymbolId, string> = {
  TEN: `${REAL_SYMBOL_BASE}/TEN.webp`,
  JACK: `${REAL_SYMBOL_BASE}/JACK.webp`,
  QUEEN: `${REAL_SYMBOL_BASE}/QUEEN.webp`,
  KING: `${REAL_SYMBOL_BASE}/KING.webp`,
  ACE: `${REAL_SYMBOL_BASE}/ACE.webp`,
  GOLD_BAR: `${REAL_SYMBOL_BASE}/GOLD_BAR.webp`,
  DIAMOND: `${REAL_SYMBOL_BASE}/DIAMOND.webp`,
  VAULT_KEY: `${REAL_SYMBOL_BASE}/VAULT_KEY.webp`,
  COIN_STACK: `${REAL_SYMBOL_BASE}/COIN_STACK.webp`,
  VAULTLINE_EMBLEM: `${REAL_SYMBOL_BASE}/VAULTLINE_EMBLEM.webp`,
  WILD: `${REAL_SYMBOL_BASE}/WILD.webp`,
  SCATTER: `${REAL_SYMBOL_BASE}/SCATTER.webp`,
  // No real art supplied for this symbol yet — keep the honest placeholder.
  LASER_DEVICE: `${PLACEHOLDER_SYMBOL_BASE}/LASER_DEVICE.png`,
};

/** Public path for a symbol's art file — also used directly as an <img src> (paytable sheet, etc). */
export function symbolArtUrl(id: SlotSymbolId): string {
  return SYMBOL_ART_URLS[id];
}

let cached: Record<SlotSymbolId, Texture> | null = null;
let cachedPromise: Promise<Record<SlotSymbolId, Texture>> | null = null;

/**
 * Loads the flat LASER_DEVICE placeholder image and redraws it onto a
 * canvas with a metallic gold-highlight/teal-shadow recolor (the same top-
 * lit bevel direction as the real art) plus a slight overall alpha
 * reduction — see the file-header comment for why. Plain 2D canvas
 * compositing only (source-atop recolor + destination-in alpha knockdown),
 * no external asset. Isolated in its own function so it's a one-line
 * removal once real LASER_DEVICE art ships (just delete the
 * `id === "LASER_DEVICE"` branch below).
 */
async function buildLaserDevicePlaceholderTexture(): Promise<Texture> {
  const img = new Image();
  const url = symbolArtUrl("LASER_DEVICE");
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });

  const size = 1024;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;

  // Same ~12% breathing room the real symbol renders carry (per the
  // "alpha-verified, mostly-transparent 1024x1024" note above), so this
  // placeholder sits at the same apparent scale as its neighbors once
  // ReelStrip's aspect-fit sizes it.
  const pad = size * 0.12;
  ctx.drawImage(img, pad, pad, size - pad * 2, size - pad * 2);

  // Recolor the visible strokes only (source-atop respects the existing
  // alpha shape) with a top-lit gold-to-teal metallic gradient — the same
  // lighting language as the real art's bevels (gold catching light near
  // the top, cooling to a dark teal shadow at the bottom).
  ctx.globalCompositeOperation = "source-atop";
  const gradient = ctx.createLinearGradient(0, 0, 0, size);
  gradient.addColorStop(0, "#f6e7ae");
  gradient.addColorStop(0.32, "#d4af37");
  gradient.addColorStop(0.6, "#2dbfb0");
  gradient.addColorStop(1, "#0d3a35");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  // Slight overall alpha knockdown — reads as "visually recessive /
  // pending", never fully hidden (spec item 7, option (b)).
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = "rgba(0,0,0,0.82)";
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = "source-over";

  return Texture.from(c);
}

/**
 * Loads every symbol texture once via PIXI.Assets.load and caches the
 * result — every subsequent call (e.g. remounting the renderer after a
 * resize/route change) reuses the already-decoded GPU textures instead of
 * re-fetching. Must run client-side (Assets needs a document/fetch context).
 */
export async function buildSymbolTextures(): Promise<Record<SlotSymbolId, Texture>> {
  if (cached) return cached;
  if (cachedPromise) return cachedPromise;

  cachedPromise = (async () => {
    for (const id of ALL_SYMBOL_IDS) {
      if (id === "LASER_DEVICE") continue;
      Assets.add({ alias: id, src: symbolArtUrl(id) });
    }
    const idsToLoad = ALL_SYMBOL_IDS.filter((id) => id !== "LASER_DEVICE");
    const [loaded, laserDevice] = await Promise.all([
      Assets.load<Texture>(idsToLoad),
      buildLaserDevicePlaceholderTexture(),
    ]);
    const out = {} as Record<SlotSymbolId, Texture>;
    for (const id of idsToLoad) {
      out[id] = loaded[id];
    }
    out.LASER_DEVICE = laserDevice;
    cached = out;
    return out;
  })();

  return cachedPromise;
}
