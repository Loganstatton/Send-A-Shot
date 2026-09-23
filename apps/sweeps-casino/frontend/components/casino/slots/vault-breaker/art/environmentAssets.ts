// Vault Breaker environment art contract (V5) — background + machine frame.
//
// Mirrors symbolAssets.ts's rule: every "environment" layer slot resolves
// to exactly one thing in exactly one place, so a future real-art drop-in
// requires touching only this file (and, for the frame, the one loader
// below), never SlotRenderer's layout/z-order/animation code.
//
// CURRENT STATE: no real background photo or frame PNGs exist yet — every
// path below is a NAMED FUTURE LOCATION, not something fetched today.
// SlotRenderer fills each of these layer slots (backgroundLayer, frameTop,
// frameLeft, frameRight, frameBase) with a procedural PIXI Graphics/canvas
// gradient (see art/fx.ts's buildRadialVignetteTexture /
// buildVerticalGradientTexture) — depth shading, not painted scenery, per
// the product owner's instruction. When real art is supplied:
//   1. Drop the file at the matching path below.
//   2. Point that one Sprite's `.texture` at a `PIXI.Assets.load(url)`
//      result instead of the procedural builder (same pattern as
//      buildSymbolTextures in symbolAssets.ts).
// Nothing else changes.
export const BACKGROUND_ART_URL = "/games/vault-breaker/real/backgrounds/base.jpg";

export const FRAME_ART_URLS = {
  top: "/games/vault-breaker/real/frame/top.webp",
  left: "/games/vault-breaker/real/frame/left.webp",
  right: "/games/vault-breaker/real/frame/right.webp",
  bottom: "/games/vault-breaker/real/frame/bottom.webp",
} as const;
