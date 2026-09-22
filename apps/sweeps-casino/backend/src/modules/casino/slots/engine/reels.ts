import { GameConfig } from './types';

/** A dealt grid: grid[reelIndex][rowIndex] = symbolId. */
export type Grid = string[][];

/**
 * Maps a [0,1) float to a stop index on a weighted reel strip. The strip
 * array itself encodes symbol weighting by repetition (a symbol appearing
 * 6 times in a 40-length strip lands ~6/40 of the time) — this is the
 * standard "weighted reel strip" slot-math model, not independent
 * per-symbol RNG, so symbol frequencies are exactly whatever the strip
 * arrays say they are and nothing else.
 */
export function floatToStopIndex(float: number, stripLength: number): number {
  const idx = Math.floor(float * stripLength);
  return idx >= stripLength ? stripLength - 1 : idx;
}

/**
 * Reads `rows` consecutive symbols starting at `stopIndex` on a reel strip,
 * wrapping around the end — this is the visible window for one reel.
 */
export function readReelWindow(strip: string[], stopIndex: number, rows: number): string[] {
  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    out.push(strip[(stopIndex + r) % strip.length]);
  }
  return out;
}

/**
 * Derives one reel-stop float per reel from `floats` (starting at
 * `floatOffset`) and builds the full visible grid. Returns the grid plus
 * the raw stop indices (needed for provably-fair verification / replay,
 * and useful for debugging/simulation) and how many floats were consumed.
 */
export function dealGrid(
  config: GameConfig,
  floats: number[],
  floatOffset: number,
): { grid: Grid; stops: number[]; floatsConsumed: number } {
  const stops: number[] = [];
  const columns: string[][] = [];
  for (let reel = 0; reel < config.reels; reel++) {
    const strip = config.reelStrips[reel];
    const stop = floatToStopIndex(floats[floatOffset + reel], strip.length);
    stops.push(stop);
    columns.push(readReelWindow(strip, stop, config.rows));
  }
  // Transpose columns (per-reel arrays) into grid[reel][row] — already in
  // that shape since `columns[reel]` IS the reel's window — kept as a
  // separate step for clarity/documentation, not because it does work.
  const grid: Grid = columns;
  return { grid, stops, floatsConsumed: config.reels };
}
