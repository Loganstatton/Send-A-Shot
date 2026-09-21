/**
 * Dice — pure floats -> outcome mapping.
 *
 * Shared by POST /casino/originals/dice/play and POST /provably-fair/verify
 * (via outcome.dispatcher.ts) so both compute the identical result from the
 * identical (serverSeed, clientSeed, nonce) triple. This file never calls
 * deriveFloats/HMAC itself — the caller derives the floats and hands them
 * in, keeping this function a pure, trivially-testable mapping.
 */

export interface DiceParams {
  /** 2-98 (exclusive of the 0/100 edges, per docs/05-api-design.md). */
  target: number;
  direction: 'OVER' | 'UNDER';
}

export interface DiceOutcome {
  win: boolean;
  /** Payout multiplier before the house edge haircut. */
  fairMultiplier: number;
  /** Payout multiplier actually credited; 0 when the round lost. */
  multiplier: number;
  result: {
    roll: number;
    target: number;
    direction: 'OVER' | 'UNDER';
  };
}

export const DICE_FLOATS_NEEDED = 1;

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function computeDiceOutcome(
  floats: number[],
  params: DiceParams,
  houseEdgeBps: number,
): DiceOutcome {
  const { target, direction } = params;

  // floats[0] is in [0, 1); scale to a 2-decimal roll in [0.00, 100.00).
  const roll = Math.round(floats[0] * 100 * 100) / 100;

  const win = direction === 'OVER' ? roll > target : roll < target;
  const winChanceRange = direction === 'OVER' ? 100 - target : target;
  const fairMultiplier = round4(100 / winChanceRange);
  const multiplier = win ? round4(fairMultiplier * (1 - houseEdgeBps / 10000)) : 0;

  return {
    win,
    fairMultiplier,
    multiplier,
    result: { roll, target, direction },
  };
}
