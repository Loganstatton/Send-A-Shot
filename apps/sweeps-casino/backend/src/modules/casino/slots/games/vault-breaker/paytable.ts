import { Paytable } from '../../engine/types';

/**
 * All values are multipliers of TOTAL bet (not bet-per-line) for that exact
 * match count. These are DESIGN-TARGET starting values, not verified —
 * `npm run simulate:vault-breaker` (see games/vault-breaker/simulate.ts)
 * reports observed RTP/hit-frequency against this table + the reel strips
 * in reel-strips.ts, and both should be tuned together until the observed
 * numbers land near the ~96% RTP / high-volatility / ~5000x max-win design
 * targets before this is treated as final.
 */
export const VAULT_BREAKER_PAYTABLE: Paytable = {
  TEN: { 3: 0.3, 4: 0.8, 5: 3 },
  JACK: { 3: 0.4, 4: 1.1, 5: 4 },
  QUEEN: { 3: 0.5, 4: 1.4, 5: 5.5 },
  KING: { 3: 0.7, 4: 1.7, 5: 7 },
  ACE: { 3: 0.8, 4: 2.2, 5: 8 },

  COIN_STACK: { 3: 1.4, 4: 4.2, 5: 14 },
  LASER_DEVICE: { 3: 2.1, 4: 5.6, 5: 20 },
  VAULT_KEY: { 3: 2.9, 4: 8.2, 5: 29 },
  DIAMOND: { 3: 4.3, 4: 14.5, 5: 43.5 },
  GOLD_BAR: { 3: 5.8, 4: 20.5, 5: 58 },
  VAULTLINE_EMBLEM: { 3: 8.2, 4: 29, 5: 87.5 },

  WILD: { 3: 14.5, 4: 43, 5: 144 },

  // Scatter pays on count anywhere on the grid, independent of paylines,
  // in addition to (potentially) triggering free spins — see
  // config.ts's `freeSpins` trigger.
  SCATTER: { 3: 5.5, 4: 14, 5: 56 },
};
