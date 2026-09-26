export const ORIGINAL_GAME_KEYS = ['dice', 'mines', 'plinko'] as const;
export type OriginalGameKey = (typeof ORIGINAL_GAME_KEYS)[number];

export interface OriginalGameConfig {
  minBet: string;
  maxBet: string;
  houseEdgeBps: number;
}

/**
 * Bet limits and house edge for each Phase 1 Original.
 *
 * NOTE (schema gap, flagged for the implementation report): the `Game`
 * Prisma model (prisma/schema.prisma) has no per-game minBet/maxBet/
 * houseEdgeBps columns — only catalog metadata (tags, sortWeight,
 * restrictedJurisdictions, supportedCurrencies, status). Unlike that
 * metadata, these values are therefore code constants here rather than
 * admin-editable rows; making them admin-configurable would need a
 * migration (out of scope — schema.prisma is off limits for this task).
 */
export const ORIGINALS_CONFIG: Record<OriginalGameKey, OriginalGameConfig> = {
  dice: { minBet: '0.10', maxBet: '1000.00', houseEdgeBps: 100 },
  mines: { minBet: '0.10', maxBet: '1000.00', houseEdgeBps: 100 },
  plinko: { minBet: '0.10', maxBet: '1000.00', houseEdgeBps: 100 },
};

export function isOriginalGameKey(value: string): value is OriginalGameKey {
  return (ORIGINAL_GAME_KEYS as readonly string[]).includes(value);
}
