/**
 * Plinko — pure floats -> outcome mapping.
 *
 * Shared by POST /casino/originals/plinko/play and POST /provably-fair/verify
 * (via outcome.dispatcher.ts). One float per row: float < 0.5 steps left,
 * else right; the ball's final bucket is the count of "right" steps
 * (0..rows), which is the standard binomial Plinko model.
 */

export type PlinkoRisk = 'LOW' | 'MEDIUM' | 'HIGH';

export interface PlinkoParams {
  /** 8-16. */
  rows: number;
  risk: PlinkoRisk;
}

export interface PlinkoOutcome {
  /** true when the credited multiplier is >= 1 (a net profit or breakeven). */
  win: boolean;
  fairMultiplier: number;
  /** Payout multiplier actually credited; always > 0 (Plinko never fully busts). */
  multiplier: number;
  result: {
    path: ('L' | 'R')[];
    bucket: number;
  };
}

export const PLINKO_MIN_ROWS = 8;
export const PLINKO_MAX_ROWS = 16;

const RISK_FACTOR: Record<PlinkoRisk, number> = { LOW: 1.5, MEDIUM: 3, HIGH: 6 };

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function plinkoFloatsNeeded(rows: number): number {
  return rows;
}

/**
 * SIMPLIFICATION (documented per the task spec): this is a formula-derived
 * approximation of a Plinko payout ladder, not a hand-tuned table verified
 * against a target RTP by simulation. Multiplier rises with the squared
 * normalized distance from the center bucket, scaled by a per-risk factor
 * (edges pay the most, center pays the least, symmetric around the
 * center) — then the shared houseEdgeBps haircut is applied like every
 * other Original, so it is only "roughly" house-edge-adjusted in
 * expectation. A production Plinko board would replace this with a table
 * whose expected value is verified to equal (1 - houseEdge) by summing
 * over the true binomial bucket-landing probabilities.
 */
export function getPlinkoMultiplierTable(rows: number, risk: PlinkoRisk): number[] {
  const center = rows / 2;
  const riskFactor = RISK_FACTOR[risk];
  const table: number[] = [];
  for (let bucket = 0; bucket <= rows; bucket++) {
    const distance = center === 0 ? 0 : Math.abs(bucket - center) / center;
    const raw = 0.5 + distance * distance * riskFactor;
    table.push(round4(raw));
  }
  return table;
}

export function computePlinkoOutcome(
  floats: number[],
  params: PlinkoParams,
  houseEdgeBps: number,
): PlinkoOutcome {
  const { rows, risk } = params;

  const path: ('L' | 'R')[] = [];
  let bucket = 0;
  for (const f of floats) {
    if (f < 0.5) {
      path.push('L');
    } else {
      path.push('R');
      bucket += 1;
    }
  }

  const table = getPlinkoMultiplierTable(rows, risk);
  const fairMultiplier = table[bucket];
  const multiplier = round4(fairMultiplier * (1 - houseEdgeBps / 10000));
  const win = multiplier >= 1;

  return { win, fairMultiplier, multiplier, result: { path, bucket } };
}
