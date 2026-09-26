/**
 * Fixed-point money helpers. All ledger amounts are stored as Prisma
 * Decimal(18,2) — we never do currency arithmetic in floating point.
 * These helpers work in integer "cents" (hundredths of a coin) to keep
 * arithmetic exact, then format back to a Decimal-compatible string.
 */

export function toCents(amount: string | number): bigint {
  const str = typeof amount === 'number' ? amount.toFixed(2) : amount;
  const [whole, frac = '0'] = str.split('.');
  const fracPadded = (frac + '00').slice(0, 2);
  const sign = whole.startsWith('-') ? -1n : 1n;
  const wholeAbs = BigInt(whole.replace('-', ''));
  return sign * (wholeAbs * 100n + BigInt(fracPadded));
}

export function fromCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${sign}${whole.toString()}.${frac}`;
}

export function addCents(a: string | number, b: string | number): string {
  return fromCents(toCents(a) + toCents(b));
}

export function isNonNegative(amount: string | number): boolean {
  return toCents(amount) >= 0n;
}

export function isPositive(amount: string | number): boolean {
  return toCents(amount) > 0n;
}
