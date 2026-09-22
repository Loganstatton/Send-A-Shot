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
