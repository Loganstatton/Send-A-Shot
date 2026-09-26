import { fromCents, toCents } from '../../../libs/money/money';

/**
 * Multiplies a decimal money string (e.g. betAmount) by a floating payout
 * multiplier and rounds to the nearest cent.
 *
 * libs/money/money.ts only exposes integer-safe addition (ledger entries
 * are always sums of already-computed amounts) — it has no multiplication
 * helper, and it's out of bounds for this task to add one there. This
 * keeps the same "never do currency arithmetic in floating point" rule by
 * doing the multiply in integer cents, scaling the multiplier to a fixed
 * 6-decimal integer first so the whole computation stays exact BigInt math
 * until the final rounding step.
 */
export function applyMultiplier(amount: string, multiplier: number): string {
  const cents = toCents(amount);
  const scaledMultiplier = BigInt(Math.round(multiplier * 1_000_000));
  const numerator = cents * scaledMultiplier;
  const denominator = 1_000_000n;
  const half = denominator / 2n;
  const rounded = numerator >= 0n ? (numerator + half) / denominator : -((-numerator + half) / denominator);
  return fromCents(rounded);
}
