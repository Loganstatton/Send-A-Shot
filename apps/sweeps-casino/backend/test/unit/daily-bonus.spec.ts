import {
  AlreadyClaimedError,
  computeNextStreakDay,
} from '../../src/modules/promotions/lib/daily-bonus';

const COOLDOWN_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;

describe('computeNextStreakDay', () => {
  it('returns day 1 for a first-ever claim (no prior claim)', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    expect(computeNextStreakDay(null, null, now, COOLDOWN_HOURS)).toBe(1);
  });

  it('continues the streak to day 2 when claimed again 25h later', () => {
    const lastClaimedAt = new Date('2026-01-01T00:00:00Z');
    const now = new Date(lastClaimedAt.getTime() + 25 * HOUR_MS);
    expect(computeNextStreakDay(lastClaimedAt, 1, now, COOLDOWN_HOURS)).toBe(2);
  });

  it('rejects a claim attempted 10h after the last one (still on cooldown)', () => {
    const lastClaimedAt = new Date('2026-01-01T00:00:00Z');
    const now = new Date(lastClaimedAt.getTime() + 10 * HOUR_MS);
    expect(() => computeNextStreakDay(lastClaimedAt, 1, now, COOLDOWN_HOURS)).toThrow(
      AlreadyClaimedError,
    );
  });

  it('wraps day 7 back to day 1 (7-day cycle)', () => {
    const lastClaimedAt = new Date('2026-01-01T00:00:00Z');
    const now = new Date(lastClaimedAt.getTime() + 25 * HOUR_MS);
    expect(computeNextStreakDay(lastClaimedAt, 7, now, COOLDOWN_HOURS)).toBe(1);
  });

  it('resets the streak to day 1 when the gap is 48h or more', () => {
    const lastClaimedAt = new Date('2026-01-01T00:00:00Z');
    const now = new Date(lastClaimedAt.getTime() + 49 * HOUR_MS);
    expect(computeNextStreakDay(lastClaimedAt, 4, now, COOLDOWN_HOURS)).toBe(1);
  });

  it('honors a custom cooldownHours from rewardConfig', () => {
    const lastClaimedAt = new Date('2026-01-01T00:00:00Z');
    const now = new Date(lastClaimedAt.getTime() + 13 * HOUR_MS);
    // With a 12h cooldown, 13h later should be claimable and continue the streak.
    expect(computeNextStreakDay(lastClaimedAt, 1, now, 12)).toBe(2);
  });
});
