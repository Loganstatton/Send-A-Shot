import { Payline } from '../../engine/types';

/**
 * 20 fixed paylines across a 5-reel x 4-row grid (rows 0=top .. 3=bottom).
 * Each line is one row-index per reel, read left to right. Explicit and
 * hand-authored (not generated) so every line is auditable — this is real
 * money math, not a placeholder.
 */
export const VAULT_BREAKER_PAYLINES: Payline[] = [
  [0, 0, 0, 0, 0],
  [1, 1, 1, 1, 1],
  [2, 2, 2, 2, 2],
  [3, 3, 3, 3, 3],
  [0, 1, 1, 1, 0],
  [3, 2, 2, 2, 3],
  [1, 0, 0, 0, 1],
  [2, 3, 3, 3, 2],
  [0, 1, 2, 1, 0],
  [3, 2, 1, 2, 3],
  [1, 2, 3, 2, 1],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2],
  [3, 3, 2, 1, 1],
  [1, 1, 2, 3, 3],
  [2, 2, 1, 0, 0],
  [0, 1, 0, 1, 0],
  [3, 2, 3, 2, 3],
  [1, 2, 1, 2, 1],
  [2, 1, 2, 1, 2],
];
