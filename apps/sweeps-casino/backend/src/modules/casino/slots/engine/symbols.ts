/**
 * Generic symbol vocabulary for the slot engine. A given game's config
 * (e.g. games/vault-breaker/config.ts) maps its own symbol IDs onto these
 * roles so the engine (payline evaluation, wild substitution, scatter
 * detection) never needs to know a game's specific symbol names.
 */

export type SymbolRole = 'PAYING' | 'WILD' | 'SCATTER' | 'BONUS';

export interface SymbolDef {
  /** Stable ID used in reel strips, paytable keys, and API responses. */
  id: string;
  role: SymbolRole;
  /** Display name shown in the paytable / game info. */
  name: string;
  /** Whether a WILD on this reel/position may substitute for this symbol. Always false for WILD/SCATTER themselves. */
  substitutable: boolean;
}
