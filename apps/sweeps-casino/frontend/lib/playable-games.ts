// Temporary frontend-side allowlist of which SLOTS-category catalog
// entries are actually playable. The backend catalog has ~16 SLOTS rows
// (Vault Heist, Neon Fortune, Golden Empire, etc.) that are seed-data
// placeholders with no real game engine behind them yet — only
// "vault-breaker" has a built, tested, live slot engine
// (backend/src/modules/casino/slots) as of this writing.
//
// There is no backend "playable" flag on Game (that's a bigger
// catalog-schema change, intentionally out of scope for the Vault Breaker
// frontend build) so this is a slug-based allowlist instead. Every other
// category (Originals, Table Games, Live Casino, Game Shows) is left
// alone — this only gates SLOTS.
//
// When a second real slot ships, add its slug here.
export const PLAYABLE_SLOT_SLUGS = ["vault-breaker"] as const;

export function isPlayableSlot(slug: string): boolean {
  return (PLAYABLE_SLOT_SLUGS as readonly string[]).includes(slug);
}

/** True if this game can actually be opened and played right now. */
export function isPlayableGame(game: { slug: string; category: string }): boolean {
  return game.category !== "SLOTS" || isPlayableSlot(game.slug);
}

// Product direction (full design-pass review, current priority: Plinko /
// Mines / Dice only — custom slot development, including Vault Breaker, is
// PAUSED): even a *technically playable* slot must not be promoted in the
// curated "hero" rails (Continue Playing / Vaultline Originals / Popular /
// Trending / New Games) any more. Vault Breaker's own dedicated page and
// the Slots category browse page are untouched by this — a player who goes
// looking for it can still find and play it; it's only pulled out of the
// rails that imply "this is a current, featured game", which is a stronger
// promise than "not fake-looking, technically works" (isPlayableGame's job
// above). Keeping this a plain category check (not a slug allowlist) means
// it automatically also keeps out any future not-yet-launched SLOTS entry
// without needing an edit here every time.
export function isFeaturableInHomeRails(game: { category: string }): boolean {
  return game.category !== "SLOTS";
}
