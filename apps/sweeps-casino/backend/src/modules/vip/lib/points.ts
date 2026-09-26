/**
 * VIP points arithmetic. Wagered amounts are Decimal(18,2) money strings,
 * multipliers are Decimal(10,4) (independent GC/SC weights, admin
 * configurable). We do this in integer (bigint) space, never JS floats, to
 * stay consistent with src/libs/money/money.ts's cents-based approach.
 *
 * pointsCents = (wageredCents * multiplierScaledBy10000) / 10000
 *
 * Points are themselves stored as Decimal(18,2) (see VipProgress), so the
 * result is formatted back through the same fromCents() helper.
 */
import { fromCents, toCents } from '../../../libs/money/money';

/** Parses a decimal string into an integer scaled by 10^decimals (no floats). */
function toScaledInt(value: string, decimals: number): bigint {
  const str = value.trim();
  const negative = str.startsWith('-');
  const [wholeRaw, fracRaw = ''] = str.replace('-', '').split('.');
  const whole = wholeRaw === '' ? '0' : wholeRaw;
  const frac = (fracRaw + '0'.repeat(decimals)).slice(0, decimals);
  const scale = 10n ** BigInt(decimals);
  const scaled = BigInt(whole) * scale + BigInt(frac === '' ? '0' : frac);
  return negative ? -scaled : scaled;
}

const MULTIPLIER_DECIMALS = 4;
const MULTIPLIER_SCALE = 10n ** BigInt(MULTIPLIER_DECIMALS);

/** Computes VIP points earned for a wager, given the level's GC or SC multiplier. */
export function computePoints(wageredAmount: string, multiplier: string): string {
  const wageredCents = toCents(wageredAmount);
  const multiplierScaled = toScaledInt(multiplier, MULTIPLIER_DECIMALS);
  const pointsCents = (wageredCents * multiplierScaled) / MULTIPLIER_SCALE;
  return fromCents(pointsCents);
}
