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
// placeholder at public/games/vault-breaker/placeholder/symbols/LASER_DEVICE.png
// until that asset is supplied — do not invent art for it here.
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
      Assets.add({ alias: id, src: symbolArtUrl(id) });
    }
    const loaded = await Assets.load<Texture>(ALL_SYMBOL_IDS);
    const out = {} as Record<SlotSymbolId, Texture>;
    for (const id of ALL_SYMBOL_IDS) {
      out[id] = loaded[id];
    }
    cached = out;
    return out;
  })();

  return cachedPromise;
}
