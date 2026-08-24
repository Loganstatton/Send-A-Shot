import { describe, expect, it } from 'vitest';
import { scoutScore } from './scout-score';

const ZERO: Parameters<typeof scoutScore>[0] = { totalReturnPct: 0, earlyDiscoveriesCount: 0, approvedDiscoveriesCount: 0, breakoutDiscoveriesCount: 0 };

describe('scoutScore', () => {
  it('is exactly 50 for a brand-new account with no activity at all', () => {
    expect(scoutScore(ZERO)).toBe(50);
  });

  it('moves up with positive return and down with negative return, weighted and capped', () => {
    expect(scoutScore({ ...ZERO, totalReturnPct: 10 })).toBe(65); // 50 + 10*1.5
    expect(scoutScore({ ...ZERO, totalReturnPct: -10 })).toBe(35); // 50 - 10*1.5
    expect(scoutScore({ ...ZERO, totalReturnPct: 1000 })).toBe(90); // capped at +40
    expect(scoutScore({ ...ZERO, totalReturnPct: -1000 })).toBe(10); // capped at -40
  });

  it('adds a capped bonus for early-discovery (buying) count', () => {
    expect(scoutScore({ ...ZERO, earlyDiscoveriesCount: 3 })).toBe(56); // 50 + 3*2
    expect(scoutScore({ ...ZERO, earlyDiscoveriesCount: 100 })).toBe(60); // capped at +10
  });

  it('adds a capped bonus for approved and breakout discoveries, breakout weighted heavier', () => {
    expect(scoutScore({ ...ZERO, approvedDiscoveriesCount: 1 })).toBe(53); // 50 + 1*3
    expect(scoutScore({ ...ZERO, breakoutDiscoveriesCount: 1 })).toBe(55); // 50 + 1*5
    expect(scoutScore({ ...ZERO, approvedDiscoveriesCount: 2, breakoutDiscoveriesCount: 1 })).toBe(61); // 50 + 2*3 + 1*5 = 61
    expect(scoutScore({ ...ZERO, approvedDiscoveriesCount: 100, breakoutDiscoveriesCount: 100 })).toBe(65); // capped at +15
  });

  it('combines all three bonuses independently and clamps the final result to [0, 100]', () => {
    // 50 + 5*1.5 (return) + 2*2 (early) + 1*3 (approved) = 50 + 7.5 + 4 + 3 = 64.5 -> Math.round -> 65.
    expect(scoutScore({ totalReturnPct: 5, earlyDiscoveriesCount: 2, approvedDiscoveriesCount: 1, breakoutDiscoveriesCount: 0 })).toBe(65);
    expect(scoutScore({ ...ZERO, totalReturnPct: -1000 })).toBeGreaterThanOrEqual(0);
    expect(scoutScore({ ...ZERO, totalReturnPct: 1000, earlyDiscoveriesCount: 100, approvedDiscoveriesCount: 100, breakoutDiscoveriesCount: 100 })).toBeLessThanOrEqual(100);
  });
});
