// Vault Breaker symbol art — V3. Every symbol is now a REAL image asset
// (apps/sweeps-casino/frontend/public/games/vault-breaker/symbols/<ID>.png),
// loaded once via PIXI.Assets and reused by every sprite that shows that
// symbol (the "pool, don't recreate" rule from the brief). This replaces
// the previous procedurally-drawn canvas icons entirely — no code-drawn
// letters/gems here anymore, per the product owner's explicit instruction
// to use the provided art as real textures, not placeholders.
//
// KNOWN LIMITATION (documented honestly, see final build report): these PNGs
// were cropped/upscaled from a single low-resolution (1024x1536) reference
// sheet the product owner generated externally — each symbol's true source
// is only ~150x160px before upscale. They establish real art direction and
// are good enough to validate the engine/motion/layout against, but will
// read as softer than true production art at native resolution up close.
// Final art needs regeneration at production resolution in this same style.

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

/** Public path for a symbol's real art file — also used directly as an <img src> (paytable sheet, etc). */
export function symbolArtUrl(id: SlotSymbolId): string {
  return `/games/vault-breaker/symbols/${id}.png`;
}

let cached: Record<SlotSymbolId, Texture> | null = null;
let cachedPromise: Promise<Record<SlotSymbolId, Texture>> | null = null;

/**
 * Loads every symbol texture once (real PNG assets via PIXI.Assets.load,
 * not canvas-drawn placeholders) and caches the result — every subsequent
 * call (e.g. remounting the renderer after a resize/route change) reuses
 * the already-decoded GPU textures instead of re-fetching. Must run
 * client-side (Assets needs a document/fetch context).
 */
export async function buildSymbolTextures(): Promise<Record<SlotSymbolId, Texture>> {
  if (cached) return cached;
  if (cachedPromise) return cachedPromise;

  cachedPromise = (async () => {
    for (const id of ALL_SYMBOL_IDS) {
      Assets.add({ alias: id, src: symbolArtUrl(id) });
    }
    const loaded = await Assets.load<Texture>(ALL_SYMBOL_IDS);
    const out = {} as Record<SlotSymbolId, Texture>;
    for (const id of ALL_SYMBOL_IDS) {
      const tex = loaded[id];
      // Crisp scaling for upscaled source art — LINEAR (the default) is
      // correct here since the art is soft/photographic-ish rather than
      // pixel art; NEAREST would make the upscale artifacts worse.
      out[id] = tex;
    }
    cached = out;
    return out;
  })();

  return cachedPromise;
}
