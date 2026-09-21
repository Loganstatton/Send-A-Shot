/**
 * Mines — pure floats -> outcome mapping.
 *
 * Shared by POST /casino/originals/mines/play and POST /provably-fair/verify
 * (via outcome.dispatcher.ts). The 5x5 grid (tiles 0-24) has `minesCount`
 * mines placed by a seeded Fisher-Yates shuffle of [0..24] driven by 25
 * floats derived from the round's (serverSeed, clientSeed, nonce) — this
 * endpoint models the whole round as "submit all picks up front, settle
 * immediately" rather than a multi-step reveal-as-you-go flow.
 */

export interface MinesParams {
  /** 1-24. */
  minesCount: number;
  /** Non-empty, unique tile indices in [0, 24], at most (25 - minesCount) of them. */
  picks: number[];
}

export interface MinesOutcome {
  win: boolean;
  fairMultiplier: number;
  /** Payout multiplier actually credited; 0 when any pick hit a mine. */
  multiplier: number;
  result: {
    minePositions: number[];
    picks: number[];
    hitMine: boolean;
  };
}

export const MINES_GRID_SIZE = 25;
export const MINES_FLOATS_NEEDED = MINES_GRID_SIZE;

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Seeded Fisher-Yates shuffle of [0..24], one float consumed per swap step,
 * so the mine layout is fully determined by the round's floats.
 */
function deriveMinePositions(floats: number[], minesCount: number): number[] {
  const indices = Array.from({ length: MINES_GRID_SIZE }, (_, i) => i);
  for (let i = MINES_GRID_SIZE - 1; i > 0; i--) {
    const j = Math.floor(floats[MINES_GRID_SIZE - 1 - i] * (i + 1));
    const tmp = indices[i];
    indices[i] = indices[j];
    indices[j] = tmp;
  }
  return indices.slice(0, minesCount).sort((a, b) => a - b);
}

/** C(n, k) via an integer-safe BigInt factorial-ratio (n is at most 25 here). */
function combination(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1n;
  for (let i = 1; i <= k; i++) {
    result = (result * BigInt(n - k + i)) / BigInt(i);
  }
  return Number(result);
}

export function computeMinesOutcome(
  floats: number[],
  params: MinesParams,
  houseEdgeBps: number,
): MinesOutcome {
  const { minesCount, picks } = params;

  const minePositions = deriveMinePositions(floats, minesCount);
  const hitMine = picks.some((p) => minePositions.includes(p));
  const win = !hitMine;

  const fairMultiplier = round4(
    combination(MINES_GRID_SIZE, picks.length) /
      combination(MINES_GRID_SIZE - minesCount, picks.length),
  );
  const multiplier = win ? round4(fairMultiplier * (1 - houseEdgeBps / 10000)) : 0;

  return {
    win,
    fairMultiplier,
    multiplier,
    result: { minePositions, picks, hitMine },
  };
}
