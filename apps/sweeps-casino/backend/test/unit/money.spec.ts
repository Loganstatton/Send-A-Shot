import { addCents, fromCents, isNonNegative, isPositive, toCents } from '../../src/libs/money/money';

describe('money helpers (fixed-point, no floats)', () => {
  it('round-trips cents', () => {
    expect(toCents('10.00')).toBe(1000n);
    expect(toCents('0.01')).toBe(1n);
    expect(toCents('-5.50')).toBe(-550n);
    expect(fromCents(1000n)).toBe('10.00');
    expect(fromCents(-550n)).toBe('-5.50');
  });

  it('adds without floating point drift', () => {
    // 0.1 + 0.2 famously != 0.3 in IEEE 754 — must be exact here.
    expect(addCents('0.10', '0.20')).toBe('0.30');
    expect(addCents('100.00', '-100.00')).toBe('0.00');
  });

  it('classifies sign correctly', () => {
    expect(isNonNegative('0.00')).toBe(true);
    expect(isNonNegative('-0.01')).toBe(false);
    expect(isPositive('0.00')).toBe(false);
    expect(isPositive('0.01')).toBe(true);
  });
});
