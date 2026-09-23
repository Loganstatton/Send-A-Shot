// Vault Breaker symbol art loader — REBUILD (V4).
//
// ART CONTRACT (read this before touching this file): every symbol maps to
// exactly one texture URL, resolved in this ONE place. Swapping placeholder
// art for real production art later means changing `SYMBOL_ART_BASE` (and/or
// the per-symbol filename in `symbolArtUrl`) — nothing in the renderer
// (ReelStrip/SlotRenderer) ever hardcodes a path, so that swap requires zero
// renderer code changes.
//
// THIS PASS uses genuinely flat, honestly-placeholder art committed at
// public/games/vault-breaker/placeholder/symbols/<ID>.png — 13 files, one
// per backend symbol ID (see backend/.../vault-breaker/symbols.ts), each a
// 1024x1024 canvas, single flat color, TRUE alpha transparency (verified:
// corner pixel alpha === 0), simple distinct silhouette. Do not add
// gradients/bevels/lighting to these files or generate new ones — see the
// build report for why (product owner is generating real art separately).
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

/** Change this one constant (and/or the per-id override below) to swap in real production art — nothing else in the engine needs to change. */
const SYMBOL_ART_BASE = "/games/vault-breaker/placeholder/symbols";

/** Public path for a symbol's art file — also used directly as an <img src> (paytable sheet, etc). */
export function symbolArtUrl(id: SlotSymbolId): string {
  return `${SYMBOL_ART_BASE}/${id}.png`;
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
