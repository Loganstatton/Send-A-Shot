// Vault Breaker environment art contract (V6 — master composition pass).
//
// Mirrors symbolAssets.ts's rule: every "environment" layer slot resolves
// to exactly one thing in exactly one place, so a future real-art drop-in
// requires touching only this file, never SlotRenderer's layout/z-order/
// animation code.
//
// CURRENT STATE: a real illustrated vault-chamber background DOES exist —
// public/games/vault-breaker/backgrounds/base-game.jpg (1600x935, the same
// gold-lit steel corridor + circular vault door as the locked master
// reference at public/games/vault-breaker/design-ref/master-v1.png) — this
// pass wires it in as a real Sprite texture (cover-fit, anchored on the
// vault door) instead of the earlier placeholder-policy radial vignette.
// The frame (top/left/right/bottom bars) still has no dedicated painted-
// metal PNGs, so SlotRenderer continues to build it from procedural
// Graphics/gradients (see art/fx.ts) — now with added gold-trim gradient
// stops, corner bolts, and teal LED accent strips layered on top so it
// reads as real machine chrome rather than flat bars. When frame PNGs are
// supplied later, point frameTop/frameLeft/frameRight/frameBase's
// `.texture` at a `PIXI.Assets.load(url)` result instead — nothing else
// changes.
export const BACKGROUND_ART_URL = "/games/vault-breaker/backgrounds/base-game.jpg";

/**
 * Horizontal focal point of BACKGROUND_ART_URL, as a 0..1 fraction of its
 * width — where the vault door's hub sits in the source photo. Used by
 * SlotRenderer's cover-fit background sizing so a narrow portrait crop of
 * this wide (1600x935) source still keeps the vault door centered, instead
 * of a dead-center crop (which would land mostly on the gold-bar pile at
 * the photo's left edge).
 */
export const BACKGROUND_FOCAL_X = 0.66;
/** Vertical focal point (0..1) — keeps the vault door's hub, not the floor/ceiling, in frame on very tall/narrow crops. */
export const BACKGROUND_FOCAL_Y = 0.46;

export const FRAME_ART_URLS = {
  top: "/games/vault-breaker/real/frame/top.webp",
  left: "/games/vault-breaker/real/frame/left.webp",
  right: "/games/vault-breaker/real/frame/right.webp",
  bottom: "/games/vault-breaker/real/frame/bottom.webp",
} as const;
