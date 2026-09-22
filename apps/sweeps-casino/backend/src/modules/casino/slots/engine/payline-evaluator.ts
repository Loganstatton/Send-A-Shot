import { Grid } from './reels';
import { GameConfig } from './types';

export interface PaylineWin {
  paylineIndex: number;
  symbolId: string;
  count: number;
  /** Reel indices (0-based, left to right) that formed the win — for highlighting. */
  positions: { reel: number; row: number }[];
  /** Multiplier of total bet, straight from the paytable (pre house-edge). */
  payoutMultiplier: number;
}

export interface ScatterResult {
  count: number;
  positions: { reel: number; row: number }[];
}

/**
 * Evaluates every configured payline left-to-right. A payline pays for the
 * longest run of matching symbols starting at reel 0, where WILD
 * substitutes for any `substitutable` paying symbol (never for SCATTER).
 * Only wins with a paytable entry for that exact (symbol, count) count —
 * most configs only define 3/4/5, so 1-2 matches never pay, matching
 * standard slot conventions.
 */
export function evaluatePaylines(grid: Grid, config: GameConfig): PaylineWin[] {
  const wins: PaylineWin[] = [];

  config.paylines.forEach((line, paylineIndex) => {
    const rowAt = (reel: number) => line[reel];
    const symbolAt = (reel: number) => grid[reel][rowAt(reel)];

    // Determine the symbol this line is trying to match: the first
    // non-wild symbol encountered, or WILD itself if the line is wilds
    // all the way through (or starts with wilds and never hits a paying
    // symbol before running off the grid).
    let matchSymbol: string | null = null;
    for (let reel = 0; reel < config.reels; reel++) {
      const sym = symbolAt(reel);
      if (sym === config.wildSymbolId) continue;
      matchSymbol = sym;
      break;
    }
    if (matchSymbol === null) {
      matchSymbol = config.wildSymbolId;
    }
    if (matchSymbol === null || matchSymbol === config.scatterSymbolId) return;

    const matchDef = config.symbols[matchSymbol];
    if (!matchDef || matchDef.role === 'SCATTER') return;

    let count = 0;
    const positions: { reel: number; row: number }[] = [];
    for (let reel = 0; reel < config.reels; reel++) {
      const sym = symbolAt(reel);
      const isMatch = sym === matchSymbol || (sym === config.wildSymbolId && matchDef.substitutable);
      if (!isMatch) break;
      count++;
      positions.push({ reel, row: rowAt(reel) });
    }

    const payoutMultiplier = config.paytable[matchSymbol]?.[count];
    if (!payoutMultiplier) return;

    wins.push({ paylineIndex, symbolId: matchSymbol, count, positions, payoutMultiplier });
  });

  return wins;
}

/** Scatter pays on count anywhere in the grid, not tied to a payline. */
export function evaluateScatter(grid: Grid, config: GameConfig): ScatterResult {
  if (!config.scatterSymbolId) return { count: 0, positions: [] };
  const positions: { reel: number; row: number }[] = [];
  for (let reel = 0; reel < config.reels; reel++) {
    for (let row = 0; row < config.rows; row++) {
      if (grid[reel][row] === config.scatterSymbolId) positions.push({ reel, row });
    }
  }
  return { count: positions.length, positions };
}

/** Scatter's own paytable entry (if any) — paid in addition to free spins, many games do this. */
export function scatterPayout(scatter: ScatterResult, config: GameConfig): number {
  if (!config.scatterSymbolId || scatter.count === 0) return 0;
  return config.paytable[config.scatterSymbolId]?.[scatter.count] ?? 0;
}
